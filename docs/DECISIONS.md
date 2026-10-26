# Architecture decision notes

## SQLite instead of a hosted database

Decision: one SQLite file with migrations, parameterized queries and WAL. It makes
installation, local ownership and transactional queue/result changes inspectable.
Trade-off: one writer at a time, a local file and bounded busy waits. This is not a
multi-host deployment. A hosted relational database fits concurrent servers,
managed backups and availability, but adds credentials, service cost and operations.

## Database schema

Normalized result storage separates files from their HTML uses. Sources:
[migrations.ts](../src/infrastructure/sqlite/migrations.ts) and
[results.ts](../src/infrastructure/sqlite/results.ts).

```mermaid
erDiagram
    AUDITS ||--o{ AUDIT_ATTEMPTS : attempts
    AUDITS ||--o{ AUDIT_RESULTS : publishes
    AUDIT_RESULTS ||--o{ IMAGE_RESOURCES : resources
    AUDIT_RESULTS ||--o{ IMAGE_OCCURRENCES : occurrences
    IMAGE_OCCURRENCES ||--o{ IMAGE_CANDIDATES : candidates
    IMAGE_RESOURCES o|--o{ IMAGE_CANDIDATES : references
    AUDIT_RESULTS ||--o{ AUDIT_DOCUMENTS : documents
    AUDIT_RESULTS ||--o{ AUDIT_ISSUES : findings
    AUDITS {
        TEXT id PK
        TEXT owner_id
        TEXT url
        TEXT idempotency_key UK
        TEXT state
        INTEGER attempts
        INTEGER max_attempts
        INTEGER created_at
        INTEGER updated_at
        INTEGER available_at
        TEXT lease_token
        INTEGER lease_until
        TEXT scan_json
        TEXT progress_json
        TEXT last_error_json
    }
    AUDIT_ATTEMPTS {
        TEXT job_id PK,FK
        INTEGER attempt PK
        INTEGER started_at
        INTEGER ended_at
        TEXT outcome
        TEXT failure_json
    }
    AUDIT_RESULTS {
        TEXT job_id PK,FK
        INTEGER attempt PK
        TEXT header_json
    }
    IMAGE_RESOURCES {
        TEXT job_id PK,FK
        INTEGER attempt PK,FK
        INTEGER ordinal PK
        TEXT id
        TEXT state
        INTEGER bytes
        INTEGER oversized
        TEXT metadata_json
    }
    IMAGE_OCCURRENCES {
        TEXT job_id PK,FK
        INTEGER attempt PK,FK
        INTEGER ordinal PK
        INTEGER image_ordinal
        TEXT id
        TEXT document_id
        TEXT alt_state
        TEXT alt_text
        TEXT metadata_json
    }
    IMAGE_CANDIDATES {
        TEXT job_id PK,FK
        INTEGER attempt PK,FK
        INTEGER ordinal PK
        INTEGER occurrence_ordinal FK
        TEXT resource_id FK
        TEXT attribute
        TEXT role
        TEXT metadata_json
    }
    AUDIT_DOCUMENTS {
        TEXT job_id PK,FK
        INTEGER attempt PK,FK
        INTEGER ordinal PK
        TEXT id
        TEXT parent_url
        TEXT kind
        TEXT url
        TEXT state
        INTEGER depth
    }
    AUDIT_ISSUES {
        TEXT job_id PK,FK
        INTEGER attempt PK,FK
        INTEGER ordinal PK
        TEXT scope
        TEXT code
        TEXT message
        TEXT occurrence_id
        TEXT resource_id
    }
    BEARER_TOKENS {
        TEXT token_hash PK
        TEXT user_id
        INTEGER created_at
    }
    WORKER_HEARTBEATS {
        TEXT worker_id PK
        INTEGER heartbeat_at
    }
    SCHEMA_MIGRATIONS {
        INTEGER version PK
    }
```

- The ERD shows database cardinality: (job_id, attempt) permits multiple result
  headers per audit. Application publication keeps at most one by deleting the
  previous header in the same transaction; job_id alone is not UNIQUE.
- Children are scoped by (job_id, attempt), with cascading deletion from the
  published result. Candidate resource and occurrence references use composite
  foreign keys so references cannot cross audits/attempts. Resource and occurrence
  IDs are unique within an attempt. Document IDs and issue references retain
  diagnostic provenance; they are not all foreign-key constrained.
- Each candidate stores only its own metadata, not a resource/occurrence snapshot.
  Inventory is joined at read time. Occurrence alt state remains independent of
  shared resource outcomes. Occurrences without candidates still get an image row.
- Filter columns (resource state/oversized and occurrence alt_state) are explicit
  and indexed. Optional fetch/browser metadata stays JSON; it is not duplicated
  in candidate or inventory snapshots. Cached summary/counts are deliberate
  derived data published in the same transaction as rows.
- audits.owner_id and bearer_tokens.user_id identify the same logical user through
  service checks. There is no users/tenants table or token-to-audit foreign key.
  Multiple tokens may belong to a user; token expiry/revocation is not implemented.
- Worker readiness heartbeats are independent of job leases. Timestamps are Unix
  milliseconds; schema_migrations records applied versions.

## Database queue instead of SQS

Decision: reuse SQLite for durable queued/running/completed/failed state and
atomic idempotency checks. No network transaction is held during auditing.
Trade-off: worker polling, lease recovery and attempt history are our responsibility.
SQS supplies managed delivery/visibility but requires cloud infrastructure and still
needs idempotent consumers, ownership, durable results and stale-write protection.

## Leases and stale-worker fencing

Claims run in short immediate transactions. A random lease token and expiration
identify the current worker; heartbeats renew the lease. Every progress/final write
checks both token and expiration. Recovery requeues expired jobs up to the attempt
limit. Result writes replace the attempt snapshot atomically and retries clear old
results. This gives at-least-once execution, not exactly-once network activity.
Clock and process pauses can cause duplicate inspection; stale workers cannot publish.
Graceful shutdown stops claiming and drains the current bounded audit.

## Shared REST and MCP services

AuditService centralizes ownership and idempotency; shared schemas validate inputs
and public DTOs exclude lease/owner internals. Transport adapters map application
errors and apply their own response bounds. Dependency rules enforce layer imports.

### Persistence interfaces

One SQLite implementation supplies three narrow capabilities:

- **AuditRepository:** owner-required creation/reads; identity comes from authentication.
- **WorkerQueue:** trusted cross-owner claims and lease-fenced writes, without token methods.
- **TokenRepository:** token hashes and user lookup, without audit/queue operations.

This reduces accidental privilege use; TypeScript interfaces are not an in-process
security sandbox. The scripted MCP bridge trades process-startup overhead for
short-lived sessions. Remote OAuth is outside this local demonstration.

## Static parsing and optional browser rendering

Decision: static Cheerio discovery remains the default. Optional Chromium snapshots
and bounded crawls/iframe inspection cover some JavaScript-created content.
All external fetches retain exact-host approval and redirect/byte/deadline controls.
Trade-off: rendering adds browser installation, execution risk and more dependencies;
timed snapshots and isolated frames are not faithful full interactive sessions.
Neither discovery strategy establishes visibility or accessibility compliance.

## Database-backed pagination

Public REST/MCP pages use versioned opaque cursors and the same page envelope.
Positions are validated and ownership is checked on every read. Recent audits use
an indexed (owner, created_at, id) keyset. Result cursors bind a published attempt,
section and filter so retry publication cannot silently mix pages.

Result rows use composite ordinal keys. Image pages join normalized occurrences,
candidates and resources, with indexed issue lookups in the same statement; there
are no application-level per-candidate queries. The joined display ordering can
require a temporary sort over the engine-bounded candidate set. Filtered totals
also require counting matches; we do not claim constant-time arbitrary site-scale
queries. Separate resource/filter indexes support outcome queries. Raise engine
limits only after profiling these joins/counts.

The engine still assembles one bounded result in memory before publication. SQL
rows/metadata are prepared outside the write transaction, then atomically published
with the summary and terminal state under the lease fence. Exports honor
backpressure and yield between batches without holding transactions.
[Upgrade procedures](OPERATIONS.md#database-and-upgrades) cover migration risks.

Use `npm run benchmark:results` for repeatable local diagnostics. Timing and sampled
heap allocation are not production SLOs or peak-memory guarantees. Tests assert
ownership, cursor stability, publication rollback, migration fidelity, and indexed
keyset/resource lookups rather than machine-dependent timing thresholds.
