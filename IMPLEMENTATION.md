# Implementation checklist

## Milestone 1 — initial scaffold

- [x] Empty-directory inspection; compact architecture and setup documentation.
- [x] Strict TypeScript, React/Vite, Fastify health endpoint and status UI.
- [x] Local scripts and generated-data/credential ignore rules.
- [x] 3 tests, strict type checks, and production builds passed.
- [x] Live API, Vite proxy, and HTML returned HTTP 200.

Verified on Node 26.8.2 / npm 11.19.1. Browser interactions and Node 24 were not
verified.
Milestones 2–4 were merged via PRs #1–#3. Milestone 5 is on feat/audit-frontend.

## Milestone 2 — static audit engine

- [x] Reusable module independent of routes, persistence, and UI.
- [x] Central explicit-host URL policy, credential rejection, checked redirects.
- [x] Cheerio discovery, base/final URL resolution, srcset and lazy candidates.
- [x] Separate occurrences/alt semantics and deduplicated resource fetching.
- [x] MIME/status/bytes/oversize findings, skips, and partial coverage reporting.
- [x] Bounded concurrency, deadlines, redirects, bytes, and discovery counts.
- [x] Transient-only retries, exponential jitter, and Retry-After deferral.
- [x] Local fixtures for discovery, redirects, duplicates, policy, retries,
      deadlines, concurrency, byte/count limits, and partial failures.
- [x] Final verification: 21 tests passed (18 engine fixtures/unit tests and 3 API/contract tests), all strict TypeScript configurations passed, and both production builds passed.
- [x] Public interface, bounds, and SSRF/accessibility limitations documented.

Verification ran with Node 26.8.2 / npm 11.19.1. Engine network tests used only local HTTP fixtures; no external site audit or browser-rendering coverage is claimed. Git diff whitespace checks passed.


## Milestone 3 — persistent jobs and worker

- [x] Versioned SQLite migrations, WAL, indexes, bound parameters.
- [x] POST/status/results/recent APIs with consistent errors and input validation.
- [x] Atomic idempotency with conflicting-payload detection.
- [x] Separate worker, atomic claims, leases, heartbeats, bounded retries.
- [x] Expiry/token-fenced progress and atomic result publication.
- [x] Crash recovery, attempt failure history, graceful drain and database cleanup.
- [x] Local fixture, independent-process concurrency, and API tests.
- [x] Final verification: 31 tests passed, including two real worker entry points; all strict type checks, production builds, and tracked-diff whitespace checks passed.
- [x] Setup, consistency model, and trade-offs documented.

Milestone 3 verification used Node 26.8.2 / npm 11.19.1, temporary local SQLite files, and loopback HTTP fixtures. OS power-loss durability, every platform signal path, and Node 24 were not exercised.


## Milestone 4 — ownership and demo authentication

- [x] Opaque random bearer credentials, hash-only SQLite storage, one-time CLI output.
- [x] Shared authenticated application service with owner-filtered reads and creation.
- [x] Owner-scoped idempotency, consistent 401 and indistinguishable foreign/missing 404.
- [x] Non-null ownership migration; legacy jobs retained under inaccessible reserved owner.
- [x] Exact local frontend CORS policy and credential-safe request logging.
- [x] Service/API user-isolation, token CLI/storage/logging, migration, and CORS tests.
- [x] Demo limitations and external OIDC/OAuth integration documented.
- [x] Final verification: 37 tests passed; strict type checks and API/frontend builds passed; git diff --check passed.

## Milestone 5 — frontend workflow

- [x] Memory-only token connection and disconnect, authenticated URL submission.
- [x] Recent jobs and details with cancellable active-only polling and stale-response guards.
- [x] Candidate inventory, distinct resource/occurrence counts, alt semantics and coverage notices.
- [x] Filters, full JSON/CSV exports and spreadsheet-formula neutralization.
- [x] Responsive layout, labelled controls, keyboard navigation and no remote previews.
- [x] Isolated real API/SQLite/separate-worker browser fixture and behavioral tests.
- [x] Final verification: 39 Node tests and 6 Chromium tests passed; strict type checks and both builds passed. Desktop/mobile screenshots inspected; keyboard connection and table scrolling verified; git diff --check passed.

## Later milestones — not implemented

- [ ] Official MCP TypeScript SDK entry point using shared application services.
- [ ] GitHub Actions checks required for PR merge.

Stop after milestone 5 verification. No commit, push, PR creation, or deployment
for this milestone unless requested.

- [x] Follow-up: native optional .env loading for API, worker, migration and token CLI; safe .env.example and ignored local configuration.
