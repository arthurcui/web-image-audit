# Local operations

For installation and configuration, start with the [README](../README.md).
For client/tool reference, see [MCP](MCP.md). Architecture and consistency decisions
are in [DECISIONS](DECISIONS.md).

## Persistence and migrations

Normal mode uses data/audits.sqlite (or AUDIT_DB_PATH); fixture mode uses
its isolated data/demo/audits.sqlite. Keep API, worker and MCP on the same database.
Connections are initialized in src/infrastructure/sqlite/connection.ts; it enables
WAL, FULL synchronization, foreign keys and a one-second busy timeout, then applies
versioned migrations. The single SQLite repository implements AuditRepository,
WorkerQueue, TokenRepository and readiness operations.

Run npm run db:migrate to apply migrations explicitly. Its entry point is
src/cli/migrate.ts. Token provisioning runs src/cli/provision-token.ts through
npm run auth:token (normal) or npm run demo:token (fixture). Newly generated tokens
print once; never capture them in shared logs. Databases and browser downloads are ignored.

## Liveness and readiness

GET /api/health is API liveness and does not depend on the worker or database.

`GET /api/ready` is an unauthenticated local readiness probe. It returns HTTP 200
only when SQLite schema access/write-lock acquisition succeeds and at least one
worker has a heartbeat newer than 15 seconds; otherwise it returns HTTP 503:

```json
{"status":"ready","checks":{"database":"ready","worker":"ready"}}
```

A missing/stale worker reports `worker: "unavailable"`. A database failure reports
`database: "unavailable"` and `worker: "unknown"`, without SQL, paths, identities,
or exception details. Both probes use Cache-Control: no-store. Example:
`curl -i http://127.0.0.1:3001/api/ready`.

Migration 4 stores worker presence separately from job leases. Idle and busy workers
renew every 5 seconds; shutdown removes their own record before draining work.
After a crash, readiness can remain positive for up to 15 seconds. Multiple workers
are supported: any fresh worker is sufficient. Expired records are pruned on renewal.
Restart API and worker after upgrading so both use the same migrated database.

The database probe uses a short transaction with the existing one-second SQLite
busy timeout; it does not modify audit data. It checks access and write-lock
availability, not disk integrity, free space, or future write durability. Worker
presence does not guarantee queue capacity, successful audits, approved target
hosts, or Chromium availability. Liveness stays independent of these checks.

## Shutdown and recovery

The API closes requests/connections on shutdown. The worker stops accepting jobs,
removes its presence record and drains its current job while renewing that job's
lease. A crash leaves a lease which another worker can recover after expiry;
stale workers cannot publish results. No OS power-loss guarantee is claimed.

If jobs stay queued, check /api/ready and start the matching worker. If a database
probe fails, check the local path, file permissions and competing SQLite writers.
If Chromium cannot launch, run npm run browser:install and restart the worker.
Historical failed jobs remain failed; submit a new audit after fixing configuration.

For fixture demos, stop normal API/frontend processes before npm run demo, and
provision with demo:token. A normal-mode token belongs to a different database.
Restart API, worker and MCP and reload the UI after updates that change contracts.

## Result storage upgrade (migration 6)

Stop API, worker and MCP processes before upgrading. With connections closed, back
up SQLite, run `npm run db:migrate`, then restart all processes. Do not run older
binaries against this schema. The upgrade preserves legacy JSON and version-5
published rows, renames jobs/job_attempts to audits/audit_attempts, separates image
resources/occurrences/candidates, and removes result_json and duplicate inventory
snapshots. Coverage and image findings share audit_issues with an explicit scope.
Schema and backfill commit atomically; failures roll back. Large histories require
temporary disk space and can make this one-time write transaction slow.

Publication prepares rows outside its transaction, then checks the worker lease
under the write lock and atomically publishes rows, summary and terminal state.
Expired workers cannot overwrite results. No transaction spans network I/O or
export yields. Do not manually modify published rows.

Result cursors refer to immutable published attempts. HTTP 409 stale_cursor means
restart pagination. If a result changes during a streamed export, restart the
failed download. Raw pages target 128 KiB of item data, allowing one oversized row
for lossless output; engine input limits bound source size. MCP additionally clips
text and limits item JSON to 20,000 bytes. Only exports reconstruct the full public
audit; interactive endpoints use bounded pages and cached summary metadata.

Run `npm run benchmark:results` for local synthetic measurements (no network,
tokens or persistent database). Sampled heap growth reflects allocation/GC and is
not a peak-RSS guarantee. Joined image pages may sort bounded candidate sets;
resource pages and recent-audit keysets use indexed ordering.
