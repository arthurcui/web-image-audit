# Website Image Audit

A local-first portfolio project: submit one webpage URL, audit its images in the
background, and inspect issues and an image inventory. An MCP interface is planned
for the same workflow.

**Milestone 2 adds a reusable static image-audit engine.** The React UI and API
still expose only milestone 1's connection check. SQLite, the queue, worker,
audit routes, inventory UI, and MCP tools are not implemented.

## Run locally

Use Node.js 24 LTS (recommended; `.nvmrc`) or Node.js 26, with npm.
No credentials, cloud services, global packages, or LLM API keys are needed.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The UI should show **Connected · API healthy**.
The API at http://127.0.0.1:3001 exposes `GET /api/health`:

```json
{"status":"ok","service":"website-image-audit"}
```

Both processes bind to loopback. Free ports 3001 and 5173 before starting; Vite
fails on conflicts instead of choosing another port. Ctrl+C stops development.
To test failure/recovery, run only `npm run dev:web`, then start
`npm run dev:api` separately and click **Check again**.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API and frontend with reload |
| `npm run dev:api` / `npm run dev:web` | Start either process separately |
| `npm run typecheck` | Strict checks for server, web, configuration, and tests |
| `npm test` | API tests and local HTTP audit fixtures; no external websites |
| `npm run build` | Type-check, emit Node ESM, bundle frontend |
| `npm run check` | Tests plus complete build/type checks |
| `npm run start:api` | Run compiled API after build |
| `npm run preview` | Preview built UI at http://127.0.0.1:4173 |

For built-artifact verification, run `npm run build`, then `npm run start:api`
and `npm run preview` in separate terminals. Preview proxies `/api` to 3001;
it is a local check, not a configured production hosting service.

## Architecture

One repository, one package and lockfile, with separate process entry points.

```text
src/
  api/                 Fastify app factory and HTTP entry point
  web/                 React + Vite connection-status UI
  application/
    health.ts          API liveness service
    audit/
      index.ts         auditPage public interface and orchestration
      types.ts         Options, results, and defaults
      policy.ts        Central URL approval policy
      fetch.ts         Bounded HTTP transport, retries, shared request cache
      discover.ts      Cheerio parsing and srcset candidate discovery
  shared/              Browser-safe health contract
  infrastructure/      Reserved: SQLite repositories and persistent queue
  worker/              Reserved: separate job-consumer entry point
  mcp/                 Reserved: official MCP TypeScript SDK entry point
tests/                 API tests and ephemeral loopback HTTP fixtures
dist/                  Generated builds (ignored)
data/                  Future SQLite runtime files (ignored)
```

The audit module depends on Node HTTP and Cheerio, with no imports from routes,
the database, or UI. Planned flow: React → API → application services → SQLite;
MCP → the same services; worker → SQLite queue → audit engine → stored results.
Queue claims, leases, retry scheduling, crash recovery, and persistence belong to
later milestones. No browser or agent framework is involved.

Node uses native ESM with NodeNext resolution; the frontend uses bundler
resolution. Both inherit strict checking, checked indexing, and exact optional
properties. The existing health endpoint is liveness only.

## Audit engine interface

```ts
import { auditPage } from './src/application/audit/index.js';

const result = await auditPage('https://example.com/page', {
  approvedHosts: ['example.com', 'images.example.com'],
  concurrency: 4,
  oversizedBytes: 500_000,
  maxImages: 100,
});
```

This is a usage example, not a recorded external audit. In TypeScript callers use
the source module; after `npm run build`, plain Node callers can import
`./dist/server/application/audit/index.js`.

`auditPage(url, options): Promise<AuditResult>` returns:

- `page`: final permitted URL, HTTP status/type when available, outcome, byte count,
  completion flag, and attempts. A failed page produces a result with no inventory.
- `occurrences`: one record per retained `img`; its own missing/empty/text alt state
  and candidates with raw URL, attribute, descriptor, media/type hints, resolved
  URL, resource ID, or skip reason. Picture sources belong to their fallback img.
- `resources`: distinct normalized requested URLs, each with inspection outcome,
  final URL, byte count, and oversized flag. Redirect aliases retain distinct
  inventory IDs but share cached network responses for their common destination.
- `issues`: missing-alt review prompts, resource failures, skipped candidates,
  and oversized findings. Empty alt is retained and is not automatically an error.
- `coverage`: whether all discovered candidates within this static model were
  inspected; reasons explicitly identify limits, failures, and skips. This is
  neither rendering coverage nor an accessibility-compliance verdict.

Invalid configuration throws before fetching. Expected network/policy/HTTP
failures are data, including per-image failures; successful siblings survive.
The module also exports its option/result types and `createUrlPolicy`.

Discovery handles img src/srcset and picture/source plus data-src, data-srcset,
data-original, and data-lazy-src. URLs resolve against the final redirected page
URL and the first base element with href. Invalid base href falls back with a
coverage warning. Fragments are removed for deduplication. Srcset tokenization
preserves commas within URL tokens, including data URLs; unsupported/invalid
descriptors are reported as skipped. Responsive and lazy sources are only
candidates: no viewport, media-query selection, or rendered visibility is inferred.

## Bounds and retry behavior

| Option | Default |
| --- | --- |
| `concurrency` | 4 active resource tasks, hard maximum 64 |
| `requestTimeoutMs` | 10,000 ms per attempt, including headers and body |
| `maxPageBytes` | 2,000,000 |
| `maxImageBytes` | 10,000,000 per image attempt |
| `oversizedBytes` | 500,000; strictly greater is oversized |
| `maxImages` | 100 distinct requested image URLs |
| `maxOccurrences` | 500 retained img elements |
| `maxCandidates` | 2,000 retained attribute/srcset candidates |
| `maxRedirects` | 5 per URL chain, hard maximum 20 |
| `maxRetries` | 2 additional attempts per hop, hard maximum 5 |
| `retryBaseMs` | 250 |
| `maxRetryDelayMs` | 5,000 |

Limits must be finite bounded integers. Retries use capped exponential backoff
with jitter. Only 408/429/500/502/503/504, deadlines, interrupted response streams,
and selected transient connection errors retry. Other HTTP failures, TLS errors,
policy failures, and byte limits do not. Retry-After seconds/dates establish a
minimum wait; long or invalid values defer the resource rather than being clamped
to an earlier retry. Exhausted retries return a failure. Deferred results are
reported only—there is no background scheduler yet.

Limits apply per attempt and per audit, not as a shared service-wide rate limit.
Redirects and retries can cause more requests than maxImages. Each attempt has
a deadline, so chains are bounded; there is no separate whole-audit deadline.
Shared-hop attempt counts describe the chain, not an additive global request total.

Page bodies are buffered only within their limit for Cheerio. Image bodies are
streamed, counted, and discarded; none appear in results or caches. Byte counts
are actual consumed response-body bytes, exact only when bytesComplete is true;
on abort they are a lower bound and may exceed the cap by the final stream chunk.
Transfer headers are not counted. Content-Length is not trusted as the measured size.
HTTP charset, HTML meta encoding, and BOM inform page decoding.

## Security and limitations

**An explicit host allowlist alone is not complete SSRF protection.** The caller
must approve exact URL.host entries (including non-default ports) for the page,
redirects, and images. An empty allowlist denies all. The page host is not
automatically trusted. Only HTTP/HTTPS without embedded credentials is permitted.
The same policy runs on every redirect and candidate. The transport has no cookie
jar and accepts no caller credentials or arbitrary headers; no cookies or
authorization are forwarded across hosts.

DNS rebinding, approved hosts resolving to private/link-local/metadata addresses,
and unsafe service ports remain risks. Before accepting arbitrary user targets,
add address validation tied to connection-time DNS resolution and network egress
controls. Tests approve only their ephemeral loopback fixture hosts. The demo API
and Vite remain loopback-only; do not expose this as a public URL-fetch endpoint.

The engine requests identity encoding and explicitly skips compressed responses.
It validates declared image MIME types, not file signatures or successful decoding:
it cannot prove a purported image is valid. It does not measure dimensions,
execute JavaScript, load CSS background images, crawl linked pages, or infer which
responsive candidate a browser displays. Standalone source elements without an
img fallback are outside the occurrence model. Static findings do not claim
complete accessibility compliance; human review remains necessary.

Dependencies are pinned with a lockfile: Fastify 5, React 19, Vite 8,
TypeScript 7, and Cheerio 1.2. SQLite and the official MCP SDK are deferred.
Secrets, generated builds, dependencies, SQLite files, and sidecars are ignored.

## Official references

- [Cheerio buffer loading and encoding](https://cheerio.js.org/docs/basics/loading/)
- [Node HTTP requests and streams](https://nodejs.org/api/http.html)
- [HTML srcset parsing](https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute)
- [Vite setup](https://vite.dev/guide/) and [proxy configuration](https://vite.dev/config/server-options.html#server-proxy)
- [React build tools](https://react.dev/learn/build-a-react-app-from-scratch)
- [Fastify testing](https://fastify.dev/docs/latest/Guides/Testing/)
- [TypeScript strict checking](https://www.typescriptlang.org/tsconfig/strict.html)
- [Official MCP SDKs](https://modelcontextprotocol.io/docs/sdk)

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for milestone verification.
