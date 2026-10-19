# Website Image Audit

A local-first portfolio project: submit a webpage URL, audit its images in the
background, and inspect issues and an image inventory. An MCP interface is planned
for the same workflow. **Milestone 1 implements only API liveness and a React UI
that calls it.** No audit engine, database, job processing, or MCP tools exist yet.

## Run locally

Use Node.js 24 LTS (recommended; `.nvmrc` is provided) or Node.js 26, with npm.
No credentials, cloud accounts, global packages, or LLM API keys are needed.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The UI should show **Connected · API healthy**.
The API listens on http://127.0.0.1:3001; `GET /api/health` returns:

```json
{"status":"ok","service":"website-image-audit"}
```

Ports are intentionally fixed and loopback-only. Free ports 3001 and 5173 before
starting. Vite fails on port conflicts rather than silently selecting another port.
Use Ctrl+C to stop development. To exercise the failure state, run only
`npm run dev:web`, then start `npm run dev:api` in another terminal and click
**Check again**. Health requests time out after five seconds.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API and frontend with reload; stops both if either exits |
| `npm run dev:api` / `npm run dev:web` | Start either process separately |
| `npm run typecheck` | Strict checks for server, web, config, and tests |
| `npm test` | Node test runner via tsx; API contract and response validation |
| `npm run build` | Type-check, emit Node ESM, bundle frontend |
| `npm run check` | Tests plus complete build/type checks |
| `npm run start:api` | Run compiled API after build |
| `npm run preview` | Preview built UI at http://127.0.0.1:4173 |

For a built-artifact smoke check, run `npm run build`, then `npm run start:api`
and `npm run preview` in separate terminals. Preview proxies `/api` to port 3001.
Vite preview is a local verification tool; production static serving is not configured.

## Compact architecture

One repository, one package and lockfile, with separate process entry points.
This avoids workspace tooling before it is needed.

```text
src/
  api/             app.ts (factory), main.ts (HTTP process)
  web/             React + Vite entry point and status panel
  application/     Transport-independent application services (health today)
  shared/          Browser-safe response types and validation
  infrastructure/  Reserved: SQLite repositories/queue, HTTP fetch, Cheerio
  worker/          Reserved: separate SQLite job consumer process
  mcp/             Reserved: official MCP TypeScript SDK, local stdio entry
tests/             API contract tests
dist/              Generated server and web builds (ignored)
data/              Future SQLite runtime files (ignored)
```

Planned flow: React → Fastify → application services → SQLite; MCP → those same
services; worker → persistent SQLite queue → audit service → stored results.
API and MCP will submit jobs and read results, with parsing/fetching executed by
the separate worker. These are process boundaries within one local application.
MCP need not call the HTTP API. SQLite will hold both application data and queue
state; transactional claims, leases/recovery, bounded retries and idempotency must
be designed in the persistence milestone. A SQLite driver will be selected then.
Cheerio will parse static HTML; JavaScript-rendered images are outside that plan.

Node code uses native ESM with NodeNext resolution; browser code uses bundler
resolution. Both inherit strict TypeScript settings, including checked indexing
and exact optional properties. Browser code imports only browser-safe contracts.
The Fastify factory is separate from startup so tests can use HTTP injection.
Liveness indicates only that the API can respond, not database or worker readiness.

## Dependencies and references

Direct dependencies are pinned, with transitive versions in `package-lock.json`.
Installations are project-local. Runtime stack: Fastify 5, React 19, Vite 8,
TypeScript 7. SQLite, Cheerio, and the official MCP SDK are deliberately deferred
until their implementation milestones rather than installed unused.

Official references checked during scaffolding:

- [Vite setup and Node requirements](https://vite.dev/guide/)
- [Vite proxy configuration](https://vite.dev/config/server-options.html#server-proxy)
- [React from scratch with a build tool](https://react.dev/learn/build-a-react-app-from-scratch)
- [Fastify startup](https://fastify.dev/docs/latest/Guides/Getting-Started/)
- [Fastify app factories and injection tests](https://fastify.dev/docs/latest/Guides/Testing/)
- [TypeScript strict checking](https://www.typescriptlang.org/tsconfig/strict.html)
- [Node release lifecycle](https://nodejs.org/en/about/previous-releases)
- [Official MCP SDKs](https://modelcontextprotocol.io/docs/sdk)

## Scope and safety

No URLs are fetched and no audit results are fabricated. Before accepting URLs,
implement SSRF protection (including redirects and private addresses), timeouts,
response size limits, and bounded concurrency. Authentication and deployment are
not part of this local scaffold. Environment secrets and generated SQLite files,
including sidecars, are ignored by Git. No database is generated in milestone 1.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for milestone status and verification.
