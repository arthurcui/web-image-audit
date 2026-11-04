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

### Worker lifecycle

Sources: [runner](../src/worker/runner.ts), [process lifecycle](../src/worker/main.ts),
and [SQLite queue](../src/infrastructure/sqlite/job-store.ts).

[![Worker lifecycle: atomic claim, inspection, lease fencing, retry, and shutdown](images/worker-lifecycle.svg)](images/worker-lifecycle.svg)

Claim and publication use short database transactions; inspection runs outside them.
The SVG is a compact overview; the Mermaid below retains the detailed branches.

<details>
<summary>Worker lifecycle — editable Mermaid source</summary>

```mermaid
flowchart TD
    Start([Start worker]) --> Presence["Start process-presence heartbeat for readiness"]
    Presence --> Stop{"Stopping?"}
    Stop -->|Yes| Close["Stop presence; close database after run exits"]
    Stop -->|No| Claim["claim: short SQLite IMMEDIATE transaction"]
    Claim --> Recover["Recover up to 100 expired running jobs; record lease_expired attempt"]
    Recover --> Exhausted{"Expired job exhausted attempts?"}
    Exhausted -->|Yes| ExpiredFail["Mark expired job failed; clear lease"]
    Exhausted -->|No| Requeue["Requeue expired job immediately; clear lease"]
    ExpiredFail --> Select
    Requeue --> Select
    Recover -->|No expired jobs| Select["Select one eligible queued job ordered by available_at, created_at, id"]
    Select --> Found{"Job available?"}
    Found -->|No| Idle["Commit; wait pollMs unless stopping"]
    Idle --> Stop
    Found -->|Yes| Assign["Delete old result; set running; increment attempt; assign token and expiry; record attempt; commit"]
    Assign --> Run["Start job heartbeat timer; await runAudit outside transactions"]
    Run -.->|Timer tick| Heartbeat["Renew lease with token, running-state, and expiry checks"]
    Heartbeat -->|False or exception| Lost["Set local lost flag"]
    Run -.->|Progress callback while not lost| Progress["Update document/image progress with the same lease fence"]
    Progress -->|False| Lost
    Progress -->|Exception propagates| Catch
    Run -->|Returns| WasLost{"Local lease-loss flag set?"}
    WasLost -->|Yes| Discard["Log lease loss; discard result"]
    WasLost -->|No| Page{"result.page.state is ok?"}
    Page -->|Yes| Complete["Prepare rows outside transaction; complete under write lock and lease fence"]
    Complete -->|Fence valid| Publish["Atomically publish result, summary, completed state and attempt outcome; clear lease"]
    Complete -->|Fence rejected| Discard
    Page -->|No| Failure["Classify page failure; calculate job retry delay"]
    Run -->|Throws| Catch["If not locally lost, call fail with retryable worker_error and backoff"]
    Catch --> Fail
    Failure --> Fail["fail: prepare optional result; acquire write lock; validate lease fence"]
    Fail -->|Fence rejected| NoWrite["No state or result write"]
    Fail -->|Fence valid| Retry{"Retryable and attempts remain?"}
    Retry -->|Yes| Scheduled["Clear old results; set queued and available_at; record failure and retry outcome; clear lease"]
    Retry -->|No| Terminal["Set failed; publish diagnostic result only if supplied; record failure and attempt; clear lease"]
    Catch -->|Already locally lost| NoWrite
    Publish --> Cleanup["Finally: clear job heartbeat timer"]
    Discard --> Cleanup
    NoWrite --> Cleanup
    Scheduled --> Cleanup
    Terminal --> Cleanup
    Cleanup --> Stop
    Claim -.->|Throws| Outer["Report loop error; wait pollMs unless stopping"]
    Outer --> Stop
    Signal([SIGINT or SIGTERM]) --> Drain["Remove process presence; set stopping; interrupt idle wait"]
    Drain -.->|No new claims| Stop
    Drain -.->|Current audit keeps its job heartbeat until settled| Run
```

- Defaults: one job per process, 30-second lease, five-second job heartbeat, and
  500 ms idle polling. Other processes may claim different jobs concurrently.
- Readiness presence is separate from the job lease. A false/throwing lease
  heartbeat marks the attempt locally lost. Network work is not cancelled;
  subsequent progress is suppressed and returned results are discarded.
- The database independently checks running state, token, and unexpired lease
  under the write lock. A heartbeat is not permission to publish later.
- Root-page success permits completion despite individual image failures.
  Retryable page failures honor Retry-After up to one day and exponential job
  backoff; longer Retry-After values are non-retryable. Unexpected worker errors
  request a bounded retry. A terminal failure may retain a supplied diagnostic result.
- Recovery happens during claim polling, not in a separate reaper. A crashed
  worker's lease must expire before recovery; duplicate inspection remains possible.
- Graceful shutdown stops new claims and drains work with job heartbeats. If a
  queue write throws, the outer loop reports it; any remaining lease can expire
  and be recovered. No exactly-once execution or forced-cancellation guarantee.

</details>

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

## HTTP fetch control flow

The [HTTP adapter](../src/application/audit/adapters/http-fetcher.ts) separates
redirect traversal, per-hop retries, and a single request. Expand each diagram
for its control flow. These diagrams describe Node HTTP fetching, not Chromium's
entire request lifecycle.

[![Combined HTTP fetch flow: redirects, retries, and a single request](images/http-fetch-control-flow.svg)](images/http-fetch-control-flow.svg)

The SVG summarizes the three layers in compact, color-coded panels. The Mermaid
source below retains the detailed branches; keep the SVG aligned when these flows change.

<details>
<summary>1. createFetcher(): policy, image-hop cache, and redirects</summary>

```mermaid
flowchart TD
    Start([Fetch URL]) --> Init["Initialize current URL, attempts = 0, redirects = 0, visited set"]
    Init --> Policy["Validate and normalize current URL"]
    Policy -->|Rejected| Skipped["Return skipped: policy rejection code"]
    Policy -->|Approved| Loop{"Normalized URL already visited?"}
    Loop -->|Yes| Cycle["Return failed: redirect-loop"]
    Loop -->|No| Visit["Add URL to visited set"]
    Visit --> Cache{"Image kind and cached promise?"}
    Cache -->|Yes| Await["Await hop promise"]
    Cache -->|No| Create["Create withRetry promise"]
    Create --> Store["For images, cache promise immediately"]
    Store --> Await
    Await --> Count["Add hop attempts to total"]
    Count --> Redirect{"Hop has Location?"}
    Redirect -->|No| Return([Return hop result with total attempts])
    Redirect -->|Yes| Limit{"redirects >= maxRedirects?"}
    Limit -->|Yes| LimitFail["Return failed: redirect-limit"]
    Limit -->|No| Target["Resolve and validate Location against current URL"]
    Target -->|Rejected| TargetFail["Return skipped: policy code or invalid-redirect"]
    Target -->|Approved| Update["Set current URL; increment redirects"]
    Update --> Policy
```

The cache belongs to one fetcher instance and stores image-hop promises, including
redirects and failures. Cache hits still undergo redirect handling. Attempt totals
include cached hop metadata; they are not counts of newly issued network requests.

</details>

<details>
<summary>2. withRetry(): retry eligibility and Retry-After</summary>

```mermaid
flowchart TD
    Start([Retry one URL and kind]) --> Init["attempt = 0"]
    Init --> Once["Await requestOnce"]
    Once --> Count["Set result.attempts = attempt + 1"]
    Count --> Eligible{"Transient result and attempt < maxRetries?"}
    Eligible -->|No| Return([Return current result])
    Eligible -->|Yes| Backoff["backoff = min(maxRetryDelayMs, retryBaseMs * 2^attempt * (0.5 + random))"]
    Backoff --> Delay["delay = max(backoff, retryAfterMs or 0)"]
    Delay --> Budget{"Retry-After present but invalid, or delay > maxRetryDelayMs?"}
    Budget -->|Yes| Deferred["Return deferred: retry-after"]
    Budget -->|No| Sleep["Wait ceil(delay) milliseconds"]
    Sleep --> Next["Increment attempt"]
    Next --> Once
```

At most `maxRetries + 1` requests run per hop. Retry-After is inspected only when
another retry is eligible; an exhausted retry loop returns the existing failure.
The delay limit is per wait, not a total fetch deadline. Each request gets a fresh
deadline, and each redirect hop gets its own retry budget.

</details>

<details>
<summary>3. requestOnce(): deadline, response validation, and streaming</summary>

```mermaid
flowchart TD
    Start([One HTTP attempt]) --> Init["Initialize byte count, chunks, abort controller, and finish guard"]
    Init --> Timer["Start requestTimeoutMs deadline"]
    Timer --> Send["Send HTTP/HTTPS GET; no automatic redirects or caller credentials"]
    Timer -.->|Deadline expires before completion| Timeout["failed: timeout; transient = true"]
    Send -->|Request error| Network["failed: network; transient only for approved error codes"]
    Send -->|Response headers| Redirect{"Status is 301, 302, 303, 307, or 308?"}
    Redirect -->|Yes| Location{"Nonempty Location?"}
    Location -->|Yes| Hop["ok with Location; do not read body"]
    Location -->|No| InvalidRedirect["failed: invalid-redirect"]
    Redirect -->|No| Partial{"Status is 206?"}
    Partial -->|Yes| PartialFail["failed: http; not transient"]
    Partial -->|No| Success{"Status is 200-299?"}
    Success -->|No| Http["failed: http; parse Retry-After; transient only for 408, 429, 500, 502, 503, 504"]
    Success -->|Yes| Type{"Content-Type valid for kind?"}
    Type -->|No| TypeFail["failed: content-type"]
    Type -->|Yes| Encoding{"Content-Encoding absent, empty, or identity?"}
    Encoding -->|No| EncodingSkip["skipped: encoding"]
    Encoding -->|Yes| Cap["Select maxImageBytes for images; maxPageBytes otherwise"]
    Cap --> Events{"Next response event"}
    Events -->|data| Bytes["Add chunk length to byte count"]
    Bytes --> Limit{"bytes > cap?"}
    Limit -->|Yes| ByteFail["failed: byte-limit"]
    Limit -->|No| Kind{"Image kind?"}
    Kind -->|Yes| Discard["Discard chunk"]
    Kind -->|No| Buffer["Buffer document or asset chunk"]
    Discard --> Events
    Buffer --> Events
    Events -->|error| StreamFail["failed: network; transient = true"]
    Events -->|end| Complete["ok; bytesComplete = true; non-images include body and charset"]
    Timeout --> Finish
    Network --> Finish
    Hop --> Finish
    InvalidRedirect --> Finish
    PartialFail --> Finish
    Http --> Finish
    TypeFail --> Finish
    EncodingSkip --> Finish
    ByteFail --> Finish
    StreamFail --> Finish
    Complete --> Finish
    Finish["finish: accept first outcome, clear timer, resolve hop, release chunks, abort request"] --> Return([Return hop])
```

Documents accept HTML/XHTML, images require an image MIME type, and assets require
a nonempty content type. Request-error retry codes are `ECONNRESET`, `ETIMEDOUT`,
`EAI_AGAIN`, `ECONNREFUSED`, and `EPIPE`; response-stream errors are always marked
transient. Only a completed body sets `bytesComplete = true`. The first completion
wins; later timeout/error/end events cannot replace its result.

</details>

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
