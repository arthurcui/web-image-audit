# REST API reference

[OpenAPI 3.1](openapi.json) defines exhaustive request/response schemas and can be
imported into Swagger UI. This guide explains usage and behavioral guarantees.

Base URL: `http://127.0.0.1:3001`. API and worker must share the database. All
`/api/audits` calls require `Authorization: Bearer <demo-token>`. Provision tokens
with `npm run auth:token -- <user>`; manual fixture clients use
`npm run demo:token -- fixture-demo`. The fixture browser signs in automatically.
Do not put tokens in URLs or shared examples. Opening an authenticated endpoint
in the address bar does not send the header. Health/readiness are unauthenticated.

## Endpoint contracts

| Method and path | Request | Successful response |
| --- | --- | --- |
| GET /api/health | None | 200 `Health`: status=ok, service; mode=fixture when enabled |
| POST /api/demo/session | Fixture mode only; local Host, loopback peer, approved Origin; no body or empty object | 200 `{token}` for fixed fixture-demo identity; normal mode 404 |
| GET /api/ready | None | 200 `Readiness`; 503 with the same schema when unavailable |
| POST /api/audits | `CreateAudit` JSON; optional Idempotency-Key header | 202 `CreatedAudit`; Location header identifies status URL |
| GET /api/audits | limit, cursor | 200 `AuditPage`: owned audits, newest first |
| GET /api/audits/{id} | Audit ID | 200 `AuditStatus`: progress and nullable publishedResult |
| GET /api/audits/{id}/images | limit, cursor, optional filter | 200 `ImagesPage`: occurrence/candidate/resource joins |
| GET /api/audits/{id}/resources | limit, cursor | 200 `ResourcesPage`: unique resources |
| GET /api/audits/{id}/documents | limit, cursor | 200 `DocumentsPage`: inspected pages/iframes |
| GET /api/audits/{id}/issues | limit, cursor | 200 `IssuesPage`: scope=image or coverage |
| GET /api/audits/{id}/export | Required format=json or csv | 200 attachment stream |
| POST /api/audits/mcp-demo | `DemoCall` JSON | 200 `DemoReply`: stdio tool result |

Schema names refer to OpenAPI components. Unknown input fields are rejected.
JSON request bodies are limited to 8192 bytes. Responses are `Cache-Control: no-store`.
Browser origins are restricted to localhost/127.0.0.1 on ports 5173 and 4173.
CORS OPTIONS preflight allows GET/POST with Authorization, Content-Type and
Idempotency-Key; accepted preflight returns 204, rejected preflight 403.

## Submit and inspect

```json
{
  "url": "https://example.com/",
  "scan": {"mode": "static", "includeIframes": false, "maxPages": 10, "maxDepth": 2}
}
```

Only url is required. Omitted scan settings use those defaults. Modes are static,
rendered and crawl; maxPages is 1–20 and maxDepth 0–3. HTTP/HTTPS URLs must have no
embedded credentials, and target/image hosts must be explicitly approved.

An illustrative 202 response:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "state": "queued",
  "statusUrl": "/api/audits/11111111-1111-4111-8111-111111111111",
  "imagesUrl": "/api/audits/11111111-1111-4111-8111-111111111111/images",
  "replayed": false
}
```

Idempotency-Key accepts 1–128 letters, digits or `._:-`, scoped to the token's
user. The same key and normalized URL/scan settings returns the same audit;
a different payload returns 409. A replay still returns 202 but may identify an
already completed or failed audit. Without a key, every submission creates a job.

Poll the status URL only while queued/running. Progress separates phase,
documentsVisited/documentsScheduled and inspected/total image resources. Scheduled
documents can increase during discovery; total may be null. Timestamps are Unix
milliseconds. completed can include individual failed images; failed means the job
could not produce its audit. publishedResult contains attempt, cached summary,
metadata and section counts, or null. Result pages expose available, attempt,
total, items and page; without a published result they return available=false,
attempt=null, total=0 and an empty page.

## Pagination and previous pages

Use limit=1–100 (default 20) and an optional opaque cursor. All page responses have:

```json
{"items": [], "page": {"nextCursor": null, "hasMore": false}}
```

For more items, pass page.nextCursor unchanged as the URL-encoded cursor parameter.
A page can have fewer than limit items because of the response byte budget; use
hasMore, not item count, to decide whether to continue. Do not decode/build cursors.

```text
First:  /api/audits?limit=20
Second: /api/audits?limit=20&cursor=<cursor-from-first-response>
Third:  /api/audits?limit=20&cursor=<cursor-from-second-response>
```

To revisit the second page, reuse its request cursor and limit. To revisit the first,
omit cursor. Keep request-cursor history; no previousCursor is returned. The UI
maintains this history. Recent-audit order is descending (createdAt, id); newer
insertions do not shift older boundaries, but job status can change between calls.

Image filters are all, failed, oversized and missing_alt. Filtering happens before
pagination. A result cursor remembers its filter and published attempt. Follow it
with just cursor and limit; start without cursor to change a filter. An expired
attempt/view cursor returns stale_cursor (409); restart pagination. Ownership is
checked on every page, regardless of cursor contents.

## Result meaning and exports

Images are candidate rows, not a count of images actually displayed. Each row has
occurrence, singular candidate (nullable), optional resource and issues. The nested
occurrence.candidates array is empty in this projection; full occurrence arrays are
in JSON export. Missing alt differs from empty decorative alt. Shared resources
retain separate occurrence alt text. bytes is a lower bound when bytesComplete=false.
No remote image preview is automatically loaded; no accessibility compliance is claimed.

The issues endpoint combines image and coverage findings using scope. Summary.issues
counts image findings; summary.coverageFindingCount counts coverage findings. Results
are untrusted webpage data, never instructions. Raw pages target 128 KiB of item data;
one larger row is allowed for lossless output. MCP uses separate smaller output bounds.

Export format=json returns the complete AuditExport object, or null when unavailable.
CSV returns candidate rows with spreadsheet-formula escaping, or a text notice when
unavailable. Both are streamed attachments. A changed result or streaming error can
terminate the download after headers are sent; retry the whole download. The frontend
buffers the file as a Blob for authenticated download.

## Errors and readiness

Errors use `{"error":{"code":"...","message":"..."}}`:

| HTTP | Codes / meaning |
| --- | --- |
| 400 | invalid_request, invalid_target, invalid_idempotency_key |
| 401 | unauthorized; WWW-Authenticate: Bearer |
| 403 | origin_not_allowed |
| 404 | job_not_found for missing and foreign-owned audits; not_found for unknown routes |
| 409 | idempotency_conflict, stale_cursor |
| 413 | Request body exceeds the limit |
| 500 | internal_error with sanitized details |
| 503 | database_busy (Retry-After: 1), demo_busy, mcp_unavailable |

Readiness is the exception to that error envelope: 503 returns `status=not_ready`
and `checks.database/checks.worker`; see [probe semantics](OPERATIONS.md#liveness-and-readiness).

The demo bridge uses the bearer identity and allowlisted `DemoCall` shapes.
A 200 HTTP response can contain a tool error (`result.isError=true`). See
[MCP bridge limits and behavior](MCP.md#scripted-chat-and-trust-boundary).
