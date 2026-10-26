# Local operations

Start with [setup and configuration](../README.md#quick-start-deterministic-demo).
Design trade-offs and schema are in [decisions](DECISIONS.md); endpoint contracts
are in [API](API.md).

## Database and upgrades

API, worker, MCP, and token provisioning must use the same database:
`data/audits.sqlite` (or `AUDIT_DB_PATH`), or isolated `data/demo/audits.sqlite`
in fixture mode. Connections enable WAL, FULL synchronization, foreign keys,
and a one-second busy timeout; startup applies versioned migrations.

To upgrade safely:

1. Stop API, worker, and MCP; back up SQLite with all connections closed.
2. Run `npm run db:migrate`.
3. Restart all processes and reload the frontend. Do not use older binaries
   against the upgraded schema or manually edit published result rows.

**Migration 6** preserves legacy JSON/version-5 results, renames jobs/attempts,
normalizes resources/occurrences/candidates, and removes duplicated snapshots.
Legacy coverage strings become `legacy-notice` findings. Schema changes and
backfill commit atomically or roll back together; allow temporary disk space
and time for its write lock.

## Liveness and readiness

| Probe | Meaning |
| --- | --- |
| `GET /api/health` | API liveness, independent of dependencies |
| `GET /api/ready` | 200 when SQLite access/write-lock acquisition succeeds and any worker heartbeat is newer than 15 seconds; otherwise 503 |

```sh
curl -i http://127.0.0.1:3001/api/ready
```

Readiness returns `status` and `checks.database` / `checks.worker`. A database
failure makes worker status `unknown`; unavailable checks expose no raw errors.
Both probes disable caching. Workers renew presence every five seconds, even
while idle; shutdown removes presence before draining work. After a crash,
readiness can remain positive for up to 15 seconds.

The database probe uses a short transaction and the one-second busy timeout.
It does not check disk integrity, free space, or future durability. Worker
presence does not prove spare capacity, approved hosts, or Chromium availability.

## Recovery

| Symptom | Action |
| --- | --- |
| Jobs stay queued | Check readiness; start the worker using the API's database |
| Database unavailable | Check path, permissions, and competing SQLite writers |
| Chromium cannot launch | Run `npm run browser:install`, then restart the worker |
| Host rejected | Explicitly approve required hosts in normal configuration; restart processes |
| Demo port occupied | Stop the conflicting process before `npm run demo` |
| Fixture sign-in fails | Confirm fixture API is running, then select **Connect to demo** |
| `stale_cursor` (409) | Restart pagination |
| Export interrupted | Retry the entire download; do not combine partial files |

Historical failed audits stay failed; submit a new job after fixing configuration.
On shutdown the API closes connections; the worker stops claiming and drains its
current bounded job while renewing its lease. Crash recovery follows lease expiry;
see [consistency guarantees](DECISIONS.md#leases-and-stale-worker-fencing).

## Fixture credentials

Fixture-only `POST /api/demo/session` requires a loopback peer, local Host, and
approved frontend Origin. It accepts no identity parameters. A random token for
`fixture-demo` is reused for the API process lifetime; only its hash is stored.
All fixture viewers share that identity/history. Browser memory holds the token;
disconnect clears it and reload signs in again. Normal mode returns 404.

Manual clients use `npm run demo:token -- fixture-demo`; normal tokens come from
`npm run auth:token -- <user>` and belong to a different database. Tokens print
once; do not put them in logs or tracked files. Demo tokens have no expiry or
revocation UI, including credentials from earlier API sessions.

## Logs and diagnostics

Worker events include audit IDs and attempts, excluding tokens, target URLs,
bodies, and raw exceptions. MCP stdout is reserved for protocol messages.
Authenticated results and exports still contain target URLs; handle them privately.

`npm run benchmark:results` uses synthetic data and an in-memory database.
Timing and sampled heap growth are diagnostics, not production SLOs or peak-memory
claims. See [query trade-offs](DECISIONS.md#database-backed-pagination) before
increasing engine limits. Run `npm run check:all` after code changes.
