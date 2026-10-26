# Implementation checklist

Status of implemented scope; rationale lives in [decisions](DECISIONS.md),
setup in [README](../README.md), and recovery in [operations](OPERATIONS.md).

- [x] **Scaffold:** strict TypeScript, React/Vite, Fastify, separate entry points.
- [x] **Engine:** static/rendered discovery, bounded crawling and iframe inspection,
  candidate/resource separation, retries, fetch policy, and explicit partial coverage.
- [x] **Jobs:** persistent SQLite queue, atomic claims, idempotency, leases,
  heartbeats, stale-worker protection, and graceful shutdown.
- [x] **Ownership:** hashed opaque tokens, owner-scoped services, narrow repository
  interfaces, and explicit public DTOs.
- [x] **UI:** memory-only tokens, document/image progress, active-only polling,
  cursor navigation, filters, and formula-safe exports.
- [x] **MCP:** validated stdio tools and scripted chat using the same services.
- [x] **Persistence:** normalized result tables, cached summaries, indexed pages,
  atomic publication, migrations, streaming exports, and readiness probes.
- [x] **Demo:** isolated local fixture, automatic fixture sign-in, illustrations,
  and a recorded product-focused walkthrough with neural narration and captions.
- [x] **Maintainability:** shared schemas, enforced layer boundaries, file-purpose
  comments, subsystem tests, OpenAPI, ERD, and installation/test/build CI.

## Verification

Run `npm run check:all` for lint, formatting, boundaries, Node tests, type checks,
production build, and browser workflows. Tests use local fixtures and temporary
SQLite databases. See the latest run output for results; this checklist does not
assert current local or remote CI success.

## Direction

Add inspection checks incrementally toward more comprehensive coverage within a
defined scope. This is future work, not a claim of complete inspection today.
