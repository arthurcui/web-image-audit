# Implementation checklist

## Milestone 1 — scaffold

- [x] Inspect current directory and preserve existing work (directory was empty).
- [x] Document one-package architecture and process boundaries.
- [x] Strict TypeScript, React/Vite frontend, Fastify API.
- [x] Health endpoint, shared contract, UI loading/error/retry states.
- [x] Local scripts, setup docs, database/credential ignore rules.
- [x] Run relevant tests, type checks, and production builds.
- [x] Smoke-check running API and Vite proxy.

Verification: `npm run check` passed on Node 26.8.2 / npm 11.19.1:
3 tests passed, all three TypeScript configurations checked, Node ESM emitted,
and Vite production bundle built. Live HTTP checks returned 200 for the API,
Vite's proxied health route (matching JSON), and the frontend HTML.
Sandbox socket restrictions required running the smoke check and servers outside
the sandbox with approval. Browser rendering/interactions and Node 24 were not
verified. Development servers were stopped after verification.

## Later milestones — not implemented

- [ ] SQLite schema, migrations, repositories, and persistent job queue.
- [ ] Separate worker with claims, leases, retries, and crash recovery.
- [ ] Safe bounded fetching and static image extraction using Cheerio.
- [ ] Image audit rules, persisted issues, and inventory UI.
- [ ] Official MCP TypeScript SDK entry point using shared application services.

Stop after milestone 1 verification. No commits, pushes, or deployment.
