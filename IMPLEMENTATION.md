# Implementation checklist

## Milestone 1 — complete

- [x] Empty-directory inspection; compact architecture and setup documentation.
- [x] Strict TypeScript, React/Vite, Fastify health endpoint and status UI.
- [x] Local scripts and generated-data/credential ignore rules.
- [x] 3 tests, strict type checks, and production builds passed.
- [x] Live API, Vite proxy, and HTML returned HTTP 200.

Verified on Node 26.8.2 / npm 11.19.1. Browser interactions and Node 24 were not
verified. Initial scaffold was committed and pushed at the user's request.
Main now requires PRs; milestone 2 work is on feat/static-image-audit.

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

## Later milestones — not implemented

- [ ] SQLite schema, migrations, repositories, and persistent job queue.
- [ ] Separate worker with claims, leases, retries, and crash recovery.
- [ ] Audit submission/result routes and persisted inventory UI.
- [ ] Official MCP TypeScript SDK entry point using shared application services.
- [ ] GitHub Actions checks required for PR merge.

Stop after milestone 2 verification. No commit, push, PR creation, or deployment
for this milestone unless requested.
