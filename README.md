# Website Image Audit

A local-first portfolio project: submit one webpage URL, audit its images in the
background, and inspect issues and an image inventory. An MCP interface is implemented
for the same workflow.

**Milestone 6 adds a local stdio MCP server using the official TypeScript SDK.**
The reusable static/rendered audit engine remains independent of routes and persistence.
The UI and MCP share authenticated application services. See [MCP setup, tools and sample workflow](src/mcp/README.md).

## Run locally

Use Node.js 24 LTS (recommended; `.nvmrc`) or Node.js 26, with npm.
No cloud services, global packages, or LLM API keys are needed. Generate a local demo token to use the UI.

```sh
npm ci
npm run browser:install
npm run dev
```

Open http://127.0.0.1:5173. The UI opens the **local demo token connection screen**.
Follow the frontend workflow below to provision a token and start the worker.
The API at http://127.0.0.1:3001 exposes `GET /api/health`:

```json
{"status":"ok","service":"website-image-audit"}
```

Both processes bind to loopback. Free ports 3001 and 5173 before starting; Vite
fails on conflicts instead of choosing another port. Ctrl+C stops development.
To test failure/recovery, run only `npm run dev:web`, attempt to connect, then start `npm run dev:api` separately and retry **Connect**.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API and frontend with reload |
| `npm run dev:api` / `npm run dev:web` | Start either process separately |
| `npm run typecheck` | Strict checks for server, web, configuration, and tests |
| `npm test` | API tests and local HTTP audit fixtures; no external websites |
| `npm run build` | Type-check, emit Node ESM, bundle frontend |
| `npm run check` | Tests plus complete build/type checks |
| `npm run test:ui` | Chromium browser tests with local API/worker fixtures |
| `npm run test:mcp` | Protocol tests using the official MCP client and stdio subprocesses |
| `npm run --silent dev:mcp` / `npm run --silent start:mcp` | Local stdio server (configured demo token required) |
| `npm run check:all` | All Node and browser tests plus build/type checks |
| `npm run start:api` | Run compiled API after build |
| `npm run dev:worker` / `npm run start:worker` | Separate development / compiled worker |
| `npm run db:migrate` | Apply SQLite migrations |
| `npm run auth:token -- <user-id>` | Provision a demo token and print it once |
| `npm run preview` | Preview built UI at http://127.0.0.1:4173 |

For built-artifact verification, run `npm run build`, then `npm run start:api`
and `npm run preview` in separate terminals. Preview proxies `/api` to 3001;
it is a local check, not a configured production hosting service.

## Architecture

One repository, one package and lockfile, with separate process entry points.

```text
src/
  api/                 Fastify app factory and HTTP entry point
  web/                 React screens, API client, cancellable polling and exports
  application/
    auth.ts            Demo authentication adapter and token provisioning
    audit-service.ts   Shared authenticated ownership boundary for API and MCP
    health.ts          API liveness service
    audit/
      index.ts         auditPage public interface and orchestration
      types.ts         Options, results, and defaults
      policy.ts        Central URL approval policy
      fetch.ts         Bounded HTTP transport, retries, shared request cache
      discover.ts      Cheerio parsing and srcset candidate discovery
      documents.ts     Bounded page/iframe discovery with provenance
      render.ts        Chromium DOM snapshots through the fetch policy
  shared/              Browser-safe health contract
  infrastructure/      SQLite migrations and fenced persistent job store
  worker/              Separate consumer entry point and testable runner
  mcp/                 Official SDK stdio entry point, tools and bounded output views
tests/                 API tests and ephemeral loopback HTTP fixtures
dist/                  Generated builds (ignored)
data/                  SQLite runtime files and sidecars (ignored)
```

The audit module depends on Node HTTP, Cheerio, and Playwright, with no imports from routes,
the database, or UI. Flow: React → API → application services → SQLite;
MCP → the same services; worker → SQLite queue → audit engine → stored results.
Queue claims, leases, retries, crash recovery, and persistence are implemented.
Both the frontend workflow and local stdio MCP adapter are implemented.

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
- `coverage`: whether all discovered candidates within the configured scan model were
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
reported by the engine; the worker separately schedules eligible page-level job retries.

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
load CSS background images, or infer which responsive candidate a browser displays.
Rendered mode executes JavaScript; crawl mode follows bounded same-origin links. Standalone source elements without an
img fallback are outside the occurrence model. Static findings do not claim
complete accessibility compliance; human review remains necessary.

Dependencies are pinned with a lockfile: Fastify 5, React 19, Vite 8,
TypeScript 7, Cheerio 1.2, and better-sqlite3 13. The official MCP SDK provides the stdio interface.
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

## Persistent jobs and worker (milestone 3)

The API and worker open the same local SQLite file, defaulting to
`data/audits.sqlite` relative to their working directory. Use the project directory
in both terminals, or set the same absolute `AUDIT_DB_PATH`. Keep the database
on a local disk, outside OneDrive or network shares. It and its WAL/SHM sidecars
are ignored by Git.

In **each** PowerShell terminal, configure the explicitly approved page and
image hosts before starting the process:

```powershell
cd C:\SideProjects\web-image-audit
$env:AUDIT_DB_PATH = 'C:\SideProjects\web-image-audit\data\audits.sqlite'
$env:AUDIT_APPROVED_HOSTS = 'example.com,images.example.com'
```

Use real target hosts you trust; this list is illustrative. It is empty by default,
so requests are denied until configured. Clients cannot submit their own allowlist.
Worker execution revalidates the target against the worker's current configuration.

Terminal 1: `npm run dev` (API + frontend). Terminal 2: `npm run dev:worker`.
After building, use `npm run start:api` and `npm run start:worker` instead.
`npm run db:migrate` explicitly initializes/upgrades the database. Both processes
also apply pending migrations on startup under a write transaction; future schema
versions are rejected. No external queue is used.

Create and inspect a job (PowerShell). First provision and load a token as shown
in the authentication section below; $headers must contain its Authorization header:

```powershell
$job = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/api/audits' -ContentType 'application/json' -Headers ($headers + @{ 'Idempotency-Key' = 'demo-001' }) -Body '{"url":"https://example.com/"}'
Invoke-RestMethod ("http://127.0.0.1:3001" + $job.statusUrl) -Headers $headers
Invoke-RestMethod ("http://127.0.0.1:3001" + $job.resultsUrl) -Headers $headers
Invoke-RestMethod 'http://127.0.0.1:3001/api/audits?limit=20' -Headers $headers
```

The React frontend now uses these same endpoints for submission, progress and inventory.

| Endpoint | Behavior |
| --- | --- |
| POST /api/audits | JSON `{"url":"https://..."}`; returns 202 with id, state, statusUrl, resultsUrl, replayed, and Location |
| GET /api/audits/:id | Current state, real progress, attempt counts, timestamps, lease expiry and lastError; no lease token |
| GET /api/audits/:id/results | 200 with state, available, result (or null), and attempt history |
| GET /api/audits?limit=20 | Recent jobs, newest first; limit 1–100, default 20; excludes result bodies |

Unknown properties, malformed JSON/URLs/IDs, and unapproved targets are rejected.
Errors use `{"error":{"code":"...","message":"..."}}`: 400 invalid input, 404
missing job, 409 idempotency conflict, 413 oversized body, 415 unsupported media,
503 database busy (Retry-After: 1), or 500 unexpected failure. Body size is 8 KiB;
URL length is at most 2048 characters. Audit endpoints require demo bearer
authentication (401); foreign and nonexistent jobs return the same 404. Disallowed
browser origins return 403. This remains a loopback-only local demo.

Idempotency-Key is optional, 1–128 letters/digits/dot/underscore/colon/hyphen.
The validated payload has only a URL, canonicalized by URL parsing with its
fragment removed. For the same authenticated user, the same key and canonical URL return the existing job—even
after completion—with 202 and replayed=true. Another canonical URL returns 409.
The user-scoped unique key and lookup/insert transaction prevent racing callers from creating
duplicates. Without a key, each POST creates a job. Keys persist for the database
lifetime; no retention/deletion endpoint exists yet.

### Consistency model

- States are queued, running, completed, failed. A completed audit can contain
  failed or skipped image resources. Failed means no successful page audit could
  be produced. A terminal page failure may still expose its diagnostic result.
- Each worker handles one job at a time. A short BEGIN IMMEDIATE transaction
  recovers up to 100 expired leases and claims one eligible job with a new random
  fencing token. SQLite serializes writers; only one claimant can win.
- Leases last 30 seconds, renewed every 5 seconds. Every heartbeat, progress,
  completion, and failure write requires the token AND an unexpired lease.
  An expired worker cannot renew itself or overwrite its replacement, even if
  recovery has not yet occurred. Times are read after obtaining the write lock.
- Three claims total are allowed, including attempts lost to crashes. Expired
  jobs are recovered on worker polling, so status may remain running until a
  worker polls again. Each attempt records its outcome and failure details.
- Recoverable page/worker failures requeue with 1s then 2s delay. Page Retry-After
  takes precedence; delays beyond one day fail rather than retry too early.
  Permanent page failures do not retry. Image failures do not trigger job retries.
- Progress reports fetching-page, then inspected/total image resources. Until
  discovery completes, total is null. Progress resets on retry. Results are not
  streamed: final JSON and terminal state publish in the same fenced transaction.
  Retry clears unpublished/obsolete result state. A read transaction returns a
  consistent result/status/attempt-history snapshot.
- Network I/O and result serialization occur outside write transactions. Queries
  use bound parameters; indexes cover queued claims, expired leases, recent jobs,
  and unique idempotency keys. SQLite uses WAL, synchronous=FULL, and a 1s busy timeout.

Execution is **at least once**, not exactly once: after a crash an image may be
downloaded again. Fencing gives a single accepted terminal publication, not
exactly-once network effects. A worker that loses its lease may finish in-flight
network work, but its writes are rejected. A stalled event loop can miss heartbeats;
fencing preserves correctness at the cost of extra work.

SIGINT/SIGTERM stops new claims and drains the current bounded audit while
continuing heartbeats, then closes the database. The API stops accepting work and
closes its connection after active requests finish. A forced kill relies on lease
expiry; draining can take as long as the engine's bounded requests/retries.
Synchronous SQLite briefly blocks each process's event loop. This is appropriate
for the small local demo, not a horizontally distributed queue. All processes
must share the same host clock and local database. Wall-clock jumps can affect
lease timing. Snapshot JSON avoids a large relational result schema but has
write/read amplification; there is no result pagination or database retention yet.

Tests use temporary SQLite files, competing child processes, controlled clocks,
and local HTTP fixtures. They cover race-free claims/idempotency, process-exit
recovery, expired and replaced lease writes, bounded retries, result replacement,
persistence across reopen, real worker processes, API validation, and graceful
worker draining. They do not simulate OS power loss or verify every OS signal path.

Official references: [better-sqlite3 transactions and parameters](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md),
[SQLite transactions](https://www.sqlite.org/lang_transaction.html),
[WAL](https://www.sqlite.org/wal.html), and
[Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).

## Demo authentication and ownership (milestone 4)

This is **demo authentication**, not an OAuth server or a production identity
system. A trusted local operator provisions random opaque bearer credentials
mapped to a user ID. No custom OAuth flow, JWT issuance, signup, or password
database is implemented.

With the same AUDIT_DB_PATH as the API and worker, run:

```powershell
npm run auth:token -- arthurcui
```

The CLI writes one newly generated token line to stdout, once. Save it in a
password manager; do not redirect it into the repository, commit it, or paste it
into a URL. There is no retrieval command. Every invocation generates a distinct
token; multiple tokens can map to the same user. User IDs are case-sensitive,
start with a letter/digit, and contain at most 64 letters/digits/dots/underscores/
hyphens. Provisioning is a privileged local command, not an unauthenticated API.

Tokens contain 32 cryptographically random bytes (256 bits) encoded with a wia_
prefix. SQLite stores only a SHA-256 digest, the mapped user ID, and creation
time. Plaintext credentials are never stored in job rows, sent to audited sites,
or included in request logs. Request serializers omit URLs, headers, and bodies;
unexpected request errors use a fixed log message. The CLI's deliberate one-time
stdout output is the only credential display. Protect terminal output and
password-manager access. Environment files and databases/sidecars remain ignored.

For API calls, load the token into memory without entering it in shell history:

```powershell
$secret = Read-Host 'Paste your audit token' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secret).Password
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod 'http://127.0.0.1:3001/api/audits' -Headers $headers
```

Remove the variables when finished. The frontend connection form accepts this token in memory; disconnecting or reloading clears it. GET /api/health remains public.

### Access-control boundary

`AuditService` in src/application/audit-service.ts authenticates every operation
and derives the owner from a trusted authentication adapter. It does not accept a
caller-supplied owner ID. API routes delegate create/list/get/results to this
service. Future MCP tools must use this same service, not invoke the worker
repository directly. Direct-service tests prove isolation independently of HTTP.

Owner predicates are applied in SQLite queries before returning jobs, results,
or attempt history, and before applying list limits. Idempotency keys are
namespaced by owner as an unambiguous JSON tuple stored under the existing unique
constraint; two users can use the same key without sharing jobs or conflicts.
The worker and local database administration are privileged internals: their
unscoped repository methods can process all users' jobs, but they are not exposed
through routes or tools. Possession of the database or filesystem access is
outside this API security boundary.

Missing, malformed, or unknown credentials return a generic 401 with
WWW-Authenticate: Bearer. A valid user requesting another user's job receives
the same 404 body as a nonexistent job. Foreign URLs, result bodies, progress, and
attempt errors are never returned. Audit responses use Cache-Control: no-store.

API and Vite bind to 127.0.0.1. CORS allows only HTTP origins on 127.0.0.1 or
localhost at ports 5173 and 4173. Preflight permits GET/POST and the Authorization,
Content-Type, and Idempotency-Key headers. Other origins (including null) are
rejected; no wildcard or cookie credential mode is enabled. CLI requests without
Origin are supported but still need bearer authentication. CORS is a browser
restriction, not a substitute for authorization or protection against local
processes.

### Existing databases

Stop old API/worker processes before upgrading; they predate authorization.
Migration 2 adds a non-null owner to every existing job and a token-hash table.
Pre-auth jobs are assigned the reserved __legacy__ owner because their real owner
cannot be inferred. That owner cannot receive a credential. Jobs/results are
preserved for local administration but hidden from every authenticated user;
there is no automatic adoption by the first user. Newly submitted audits use the
authenticated user's ID. The migration preserves lease state and attempt history.

### Production identity integration

Replace the demo authentication adapter with a maintained external OIDC/OAuth
provider integration. The provider handles user login, MFA, token issuance,
expiry, and revocation. A resource-server adapter validates API access tokens
using the provider's supported signature validation or introspection, checking
issuer, audience, lifetime, and applicable permissions. Map the verified issuer
and subject to a stable internal user ID, then retain the shared ownership checks.
Do not treat an ID token or an unverified client-supplied user ID as API authority.
Provider discovery/introspection may require an async authentication interface.

Production would also need HTTPS, credential lifecycle management, rate limits,
operational auditing without secrets, and appropriate tenant/role policy.
Current demo tokens do not expire automatically; there is no revocation command
or account lifecycle UI. Whoever holds a token can act as its user until its
hash record is removed by trusted administration. This feature does not strengthen
the audit engine's DNS/SSRF policy; its documented allowlist limitations remain.

References: [Node cryptographic random bytes and hashing](https://nodejs.org/api/crypto.html),
[Fastify logging and redaction](https://fastify.dev/docs/latest/Reference/Logging/),
[OAuth bearer-token usage](https://www.rfc-editor.org/rfc/rfc6750.html), and
[OpenID Connect](https://openid.net/specs/openid-connect-core-1_0.html).

## Frontend workflow (milestone 5)

1. Set `AUDIT_APPROVED_HOSTS` to the exact page and image hosts you intend to audit
   in **both** the API and worker terminals. The default empty allowlist rejects
   every target. See the persistent-jobs setup above for PowerShell examples.
2. Run `npm run dev` (API + web) and, in a separate terminal with the same database
   and host settings, `npm run dev:worker`.
3. Run `npm run auth:token -- your-user-id` against the same database. Enter the
   printed token on the connection screen at http://127.0.0.1:5173.
4. Submit one approved HTTP/HTTPS webpage. Select a recent audit to see progress,
   then the summary and candidate inventory. Refresh the recent list to discover
   jobs created elsewhere while no listed jobs are active.
5. Use the failed-resource, oversized-image, and missing-alt filters. JSON exports
   the full audit result; CSV exports all inventory rows, regardless of the filter.

Tokens live only in React memory: no local/session storage or cookies. Reloading
or disconnecting clears the session and removes job data from the screen. Requests
use bearer headers, a 10-second deadline, and reject redirects. An uncertain
submission retains its idempotency key when retrying the same URL.

Recent jobs and the selected detail poll sequentially every 1.5 seconds only
while their last snapshot contains active jobs. Terminal jobs stop automatically.
Closing details, switching jobs, or disconnecting aborts pending work and ignores
late responses. Request errors pause polling and provide an explicit retry control.

The summary counts unique resources separately from HTML image occurrences.
The table has one row per candidate (or one placeholder for an occurrence without
a source), retaining each occurrence's alt text. Responsive/lazy candidates are
possibilities, not proof of browser selection. Empty alt may be decorative;
missing alt is a review issue. No accessibility-compliance claim is made.
Skipped URLs, partial coverage and lower-bound byte sizes remain visible.
No remote image thumbnails are fetched by the browser.

CSV uses quoted cells with escaped quotes and prefixes formula-like cells with
an apostrophe, including formulas behind whitespace/control characters. Exported
JSON preserves the original data. Exports may contain page-provided text and URLs.

### Browser verification

Install the test browser once, then run the complete checks:

```sh
npm run browser:install
npm run check:all
```

`npm run check` runs Node tests, strict type checks and production builds.
`npm run test:ui` runs Playwright Chromium tests. The browser suite uses dedicated
loopback ports **4173, 3101 and 3102**; stop a running preview on 4173 first.
It starts an isolated Vite frontend, a real Fastify API, a temporary SQLite
database and a separate worker against local HTTP fixtures. Its deterministic
test token is accepted only by that disposable database. It never uses your
demo database or personal token.

The real workflow test covers submit-to-results, duplicate resources, alt
semantics, partial failures, filters, downloads and mobile overflow. Additional
browser tests cover active/terminal polling, stale responses, component cleanup,
authentication/input errors, retries, empty results, and disconnect/reload.
Screenshots of fixture results are written under ignored `test-results/`.
Traces, videos and automatic screenshots are disabled so normal test runs do
not capture entered credentials. Chromium is the verified browser; no claim is
made about other browsers or assistive-technology testing.

Implementation references:
[React effect cleanup](https://react.dev/reference/react/useEffect),
[Playwright web servers](https://playwright.dev/docs/test-webserver), and
[Playwright assertions](https://playwright.dev/docs/test-assertions).

## Local environment file

API, worker, migration and token-provisioning npm commands automatically load
an optional `.env` from the repository root using Node's native
[`--env-file-if-exists`](https://nodejs.org/api/cli.html#--env-file-if-existsfile).
No additional dependency is needed. Tests do not load this file.

Copy `.env.example` to `.env` once (do not overwrite an existing local file),
then set your explicitly approved hosts, for example:

```dotenv
AUDIT_APPROVED_HOSTS=cnbible.com,www.cnbible.com
AUDIT_DB_PATH=data/audits.sqlite
```

Run `npm run dev` and `npm run dev:worker` in separate terminals as before;
there is no need to set PowerShell variables in each terminal. Restart both
commands after changing `.env`, including in watch mode. Existing shell
variables take precedence over file values; use fresh terminals or remove
previous AUDIT_APPROVED_HOSTS/AUDIT_DB_PATH shell overrides when switching.
Missing `.env` is allowed; without shell overrides the default allowlist is
empty (deny all), and the database path is data/audits.sqlite.

`.env.example` is safe to commit; `.env` and SQLite files remain Git-ignored.
Keep bearer tokens out of both files and never use a VITE_ prefix for secrets,
since Vite exposes prefixed values to browser code. The web app does not need
these server settings in its bundle.

The frontend also includes a **Scripted MCP demo** chat panel. After connecting, use commands such as Audit https://cnbible.com/, Check its status, Show the issues, and List my audits. It calls the real stdio MCP server through an authenticated local bridge, without an AI model or LLM key. See [chat demo instructions](src/mcp/README.md#scripted-chat-demo-in-the-frontend).

## Rendered pages, site crawling and iframe documents

In **New audit**, choose **Static page**, **Rendered page (JavaScript)**, or
**Rendered site crawl**. Enable **Inspect iframe documents** to include frames.
Static page remains the default for existing API/MCP callers. Install the matching
Chromium binary with `npm run browser:install`, then restart the API and worker.
The database automatically migrates existing jobs to static-page options.

API creation accepts an optional `scan` object; MCP `start_audit` accepts the same object:

```json
{"url":"https://example.com/","scan":{"mode":"crawl","includeIframes":true,"maxPages":10,"maxDepth":2}}
```

Scan settings are persisted with the job and included in idempotency comparisons.
The engine's `AuditOptions.scan` accepts the same settings. Results include
`scan`, a `documents` inventory, and `documentId`/`documentUrl` on each occurrence.
Resource deduplication and image/occurrence/candidate limits apply across the entire
job. A failed child document leaves the successful root audit completed with partial
coverage. Failure to fetch/render the starting page fails the job.

Crawling uses breadth-first, fragment-normalized URL discovery from anchors. It
stays on the final starting page's origin, including redirects, with a default
10 pages/depth 2 and hard maxima 20 pages/depth 3. Query strings remain distinct;
cycles and duplicate URLs are skipped. Frame links do not expand the site crawl.
Frames may use other explicitly approved hosts. Up to 10 frame documents and two
frame nesting levels are inspected, including bounded inline `srcdoc` documents.
Duplicate frame URLs are inspected once; occurrences represent unique document
snapshots, not every visual embedding. Document discovery stops scheduling after
120 seconds (checked between documents); in-flight bounded requests may finish later.

Each rendered document uses a fresh 1280×900 Chromium context, waits one second
after DOMContentLoaded, then extracts at most 2 MB of DOM HTML. Rendering has a
15-second context deadline plus a 10-second launch deadline. All network requests
are intercepted: approved GET script/style/fetch/XHR dependencies go through the
same credential-free HTTP policy, byte limits, redirects, retries and deadlines.
There are at most 50 such dependency requests per document, with the configured
concurrency cap; excess requests are blocked and reported. No route is continued
directly to the network. Images are inspected separately without retaining bodies.
Browser image/media/font loading, workers, service workers, sockets, popups'
network access, forms and script navigation are blocked. Cookies and authentication
headers are never forwarded. Approve required script/API hosts as well as page,
frame and image hosts; blocked dependencies may prevent images from being created.

This is an approximate DOM discovery mode, not a full browser fidelity test.
It does not click, log in, scroll indefinitely, inspect shadow roots or CSS
backgrounds, or guarantee discovery of late content. Image-load-dependent scripts
may fail because browser image downloads are blocked. Frames render independently;
parent scripting, postMessage and inherited sessions are not reproduced. Original
response security/CORS headers and redirect-relative script behavior are not fully
reproduced by the bounded fetch bridge. Rendered coverage is always marked partial
with its snapshot limitation. Missing/empty alt semantics remain unchanged.

Only crawl approved sites you operate or have permission to inspect. This small
crawler does not implement robots.txt scheduling or sitemap discovery. Browser
execution expands the trust boundary: an allowlist and interception are not a
hardened sandbox or complete SSRF defense. A production deployment needs isolated
browser processes, resource quotas and network egress controls.

Playwright APIs were checked against the official
[BrowserContext](https://playwright.dev/docs/api/class-browsercontext),
[Route](https://playwright.dev/docs/api/class-route), and
[Page](https://playwright.dev/docs/api/class-page) references.


### Troubleshooting browser startup

If the worker cannot find Chromium, run `npm run browser:install` in the same
terminal environment as the worker. Windows sandboxed terminals can use a different
`LOCALAPPDATA` cache directory from ordinary PowerShell. To use a known installed
browser, set `AUDIT_BROWSER_EXECUTABLE=C:/absolute/path/to/chrome.exe` in the ignored
local `.env`, then restart `npm run dev:worker`. This setting is trusted local
configuration and is never accepted from an audit request. After a Playwright
upgrade, reinstall the matching browser and update an explicit path if necessary.

Startup, navigation, timeout and DOM-size failures now have separate messages.
A browser blocked by OS permissions still requires a terminal permitted to launch
it; configuring an executable path does not grant permissions. Existing failed
jobs remain historical records; submit a new audit after fixing the configuration.


The browser installer now writes to ignored `data/browsers` and records the matching
executable in ignored `data/browser-runtime.json`. The worker reads this manifest
on each rendered document; it takes priority over an inherited
`AUDIT_BROWSER_EXECUTABLE` value. This avoids user-profile cache visibility differences
and stale environment values inherited by Node watch processes. Run the installer
again after upgrading Playwright or moving the project. With no project manifest,
the explicit environment setting and then Playwright's default cache are used.
