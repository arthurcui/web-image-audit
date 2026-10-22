# Implementation checklist

This checklist records implemented scope. Setup is in [README](../README.md),
operational guidance in [operations](OPERATIONS.md), and trade-offs in
[architecture decisions](DECISIONS.md).

## Milestones

- [x] **1 — Scaffold:** strict TypeScript, React/Vite, Fastify health endpoint,
  separate entry points, local scripts and generated-data ignore rules.
- [x] **2 — Audit engine:** static discovery, base/redirect resolution, responsive
  and lazy candidates, resource deduplication, independent alt semantics,
  bounded fetching/retries and explicit partial coverage.
- [x] **3 — Jobs and worker:** SQLite migrations, atomic claims, idempotency,
  leases/heartbeats, stale-worker fencing, bounded retries and graceful shutdown.
- [x] **4 — Ownership:** provisioned opaque tokens, hash-only storage, shared
  service authorization, owner-scoped reads and isolation tests.
- [x] **5 — Frontend:** memory-only connection, submission, active-only polling,
  detail/inventory, filters, safe JSON/CSV exports and browser workflow tests.
- [x] **6 — MCP:** four validated stdio tools, configured identity, shared
  authorization, bounded pagination, protocol-client tests and setup reference.
- [x] **7 — Demo:** deterministic labeled fixture, isolated configuration using
  normal fetch policy, five-minute script, decision notes, structured safe logs,
  and an installation/test/build GitHub Actions workflow.

## Follow-up improvements

- [x] Scripted MCP chat using a real local stdio client; no AI model required.
- [x] Optional rendered snapshots, bounded same-origin crawling and independent
  iframe inspection, with document provenance and coverage limits.
- [x] Project-local browser installation and sanitized startup diagnostics.
- [x] Responsive small-image fixture fallback and visibly large oversized image.
- [x] Browser-safe shared contracts and automated dependency boundary checks.
- [x] Database/worker readiness probe, separate from API liveness.
- [x] Separate AuditRepository, privileged WorkerQueue and TokenRepository
  interfaces sharing one SQLite implementation; public reads require an owner.
- [x] Explicit audit/fetch names and structured coverage code/message findings;
  stored legacy coverage is normalized during migration 6.
- [x] App composition separated from connection, submission, recent-list and
  detail components; HTTP/Playwright adapters grouped within the audit module.
- [x] CLI entry points under src/cli; SQLite connection, repository and migrations
  under src/infrastructure/sqlite; tests grouped by subsystem.
- [x] Focused setup, MCP, operations, demo and decision documentation.

- [x] Shared input schemas and inferred types across service, browser and MCP;
  transport-specific output bounds remain separate.
- [x] Transport-independent application errors and explicit public job/result DTOs.
- [x] Shared summary counts, correctness linting and consistent formatting in CI.
- [x] Regression coverage for malformed inputs and private-field exclusion.

- [x] Separate document discovery/rendering progress from image inspection counts.
- [x] Owner-scoped REST cursors and Older/Newer navigation for recent audits.
- [x] Bounded REST result endpoints and shared storage services with MCP; full streaming exports.

- [x] Migration 6 replaces initial result rows with normalized image tables and cached summaries.
- [x] Indexed cursor pages, SQL inventory filters, limit-plus-one recent lists,
  and attempt-bound cursor rejection preserve ownership and stale-worker fencing.
- [x] UI loads summary/pages; JSON/CSV exports stream database batches.
- [x] Added query-plan, migration, cursor, publication rollback and export tests;
  reproducible synthetic benchmark records latency, bytes and sampled heap growth.

## Verification

Latest local verification: 74 Node tests, lint, formatting,
dependency boundaries, strict type checks and production build passed. The most recent
Chromium UI run passed 11 tests; documentation-only changes did not rerun those workflows.

Run `npm run check:all` for dependency boundaries, Node tests, strict type checks,
production builds and Chromium UI workflows. Tests use local fixtures and temporary
SQLite databases. See README for focused test commands.

Remote CI status and branch-protection configuration must be checked on GitHub;
this checklist does not assert that a remote workflow or required check passed.


## API and persistence redesign

- [x] Explicit REST image/resource/document/issue endpoints and cached status summary.
- [x] Opaque cursor contract and common page envelope for REST/MCP.
- [x] Normalize resources, occurrences, candidates, documents and scoped findings.
- [x] Transactional migration preserving existing audit history and lease-fenced publication.
- [x] UI/demo consumers, streaming exports, migration/cursor regression tests and updated ERD.

- [x] Disabled navigation buttons use the normal cursor instead of a busy indicator.
- [x] Documentation cross-check covers current routes, forward-only cursors, migration 6 and ERD constraints.

- [x] Current REST endpoint contracts documented in OpenAPI and API usage guide.
