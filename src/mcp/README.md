# Local MCP server

This stdio adapter uses the official TypeScript SDK v2:
`@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/client@2.3.1`
(test client), and Zod 4.6.7. APIs were checked against the current official
[stdio guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio),
[tool registration tutorial](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server),
and [client testing guide](https://ts.sdk.modelcontextprotocol.io/v2/testing).

## Launch

From the repository root:

```powershell
npm ci
npm run build
npm run auth:token -- your-user-id
```

Enter that token through a secure prompt, rather than putting it in a command,
tracked file, tool arguments, or chat:

```powershell
$secret = Read-Host 'Demo token' -AsSecureString
$env:AUDIT_DEMO_TOKEN = [System.Net.NetworkCredential]::new('', $secret).Password
node --env-file-if-exists=.env dist/server/mcp/main.js
```

The server waits silently for MCP JSON-RPC on stdin. It is not an interactive
terminal CLI or HTTP endpoint. A compatible host normally spawns it and owns
these pipes. There is no MCP network listener or cloud dependency.

The existing `.env` supplies `AUDIT_DB_PATH` and `AUDIT_APPROVED_HOSTS`.
Do not put the token in that file. Use the host's private environment/secret
configuration or the inherited process environment. Existing shell variables
take precedence. Provisioning, API, MCP and worker must use the same database;
MCP and worker must have matching explicitly approved hosts.

Run `npm run dev:worker` in another terminal (or `npm run start:worker` after
building). MCP only queues jobs; it never starts the worker or waits for a scan.
The API/frontend processes are optional for MCP usage.

For source development, use
`node --env-file-if-exists=.env --import tsx src/mcp/main.ts`.
Convenience aliases exist as `npm run --silent dev:mcp` and
`npm run --silent start:mcp`. Use **node directly in client configuration**;
ordinary npm banners would contaminate stdout. No watch process is used.

Missing/invalid credentials cause a generic stderr diagnostic and exit code 1.
Normal stdout contains only protocol messages. Stdin EOF and SIGINT/SIGTERM
close the transport/database. Remove `Env:AUDIT_DEMO_TOKEN` from your shell
when finished. No LLM API key is needed.

## Compatible client configuration

For clients that use an `mcpServers` configuration, this is a template.
Adjust the executable/project paths and supply AUDIT_DEMO_TOKEN through the
client's private secret/environment mechanism (never commit its value):

```json
{
  "mcpServers": {
    "website-image-audit": {
      "command": "node",
      "args": [
        "--env-file-if-exists=C:/SideProjects/web-image-audit/.env",
        "C:/SideProjects/web-image-audit/dist/server/mcp/main.js"
      ],
      "env": {
        "AUDIT_DB_PATH": "C:/SideProjects/web-image-audit/data/audits.sqlite"
      }
    }
  }
}
```

The token must reach the spawned server as AUDIT_DEMO_TOKEN. Clients differ in
environment inheritance and secret configuration; launching a desktop client
from an unrelated shell does not automatically give it this shell's token.
Use an absolute database path because the client's working directory may differ.
The example loads approved hosts from the project's .env and overrides its
relative database path with an absolute one. Restart the MCP connection after
configuration changes.

## Tools

All tools reject unknown input properties and validate output schemas.
No tool accepts userId, ownerId or a token as identity. Each call passes the
configured bearer credential to the same AuditService used by the HTTP API.

| Tool | Inputs | Output |
| --- | --- | --- |
| start_audit | url; optional idempotencyKey | id, state, replayed immediately after enqueue |
| get_audit_status | id | job state, progress, creation time, attempt count, last error |
| get_audit_results | id; section (default issues), offset (default 0), limit (default 10) | summary and one page; available=false until a result exists |
| list_audits | limit (default 10), optional before | recent owned jobs and nextCursor |

Success uses `{ok:true,data:...,error:null}`. Application failures set MCP
`isError:true` and return `{ok:false,data:null,error:{code,message}}`.
SDK input-validation failures use its standard tool-error format. Unknown and
foreign job IDs share the same job_not_found response.

Idempotency keys are scoped per user: the same key and normalized URL return
the same job, while a different URL conflicts. Without a key, every call creates
a new job; start_audit is therefore not advertised as universally idempotent.

Results sections: **summary**, **issues**, **resources**, **candidates**, and
**coverage** (incomplete-coverage reasons). Summary is counts only; all other
sections also include it. Page sizes are 1–20, offsets 0–1,000,000. Follow
nextOffset with the same job/section until null. A large page may return fewer
items than requested to meet the byte budget. Offsets beyond the end return
an empty page. Stored terminal results are immutable, so their offsets are
stable. Active attempts do not expose transient partial snapshots.

Strings are clipped to 256 UTF-16 code units with an ellipsis and an explicit
truncatedFields flag. Full values remain in the stored audit/API/frontend
exports. Escaped UTF-8 item JSON is limited to 20,000 bytes; normal tool results,
including both text and structured copies, stay below 64 KiB. Responses omit
raw HTML, image bodies and unbounded nested candidate arrays. Counts distinguish
unique resources, occurrences, candidates, missing alt, and empty alt.

List pagination uses the descending (createdAt, id) keyset; pass nextCursor as
before. Newer insertions do not shift subsequent pages. Cursors describe positions
and never grant access. Each query still filters by the authenticated owner.
Job status may change between pages: this is not a database-wide snapshot.
Result pagination bounds the wire response; the service still parses the stored
result JSON in memory. Database-level streaming is not implemented.

## Sample workflow

The following illustrates the protocol test's local fixture (two images, one
missing alt and one HTTP 404). IDs are illustrative, not a saved external audit.

1. `start_audit({"url":"http://127.0.0.1:3102/","idempotencyKey":"demo-001"})`
   → `{"ok":true,"data":{"id":"11111111-1111-4111-8111-111111111111","state":"queued","replayed":false},"error":null}`
2. `get_audit_status({"id":"11111111-1111-4111-8111-111111111111"})`
   → data.job.state is queued/running while active. Check again later; each call
   returns immediately. The separate worker eventually publishes completed.
3. `get_audit_results({"id":"11111111-1111-4111-8111-111111111111","section":"issues","limit":5})`
   → summary has uniqueResources=2, htmlOccurrences=2, failedResources=1,
   missingAlt=1, emptyAlt=1; issues report missing-alt and HTTP failure.

A concise assistant summary could be: “Inspected 2 unique resources across
2 HTML image occurrences. One resource returned HTTP 404; one occurrence lacks
alt. One empty alt may be decorative. Coverage is partial.”

The test fixture is temporary, uses a dynamic loopback port, and exists only
during tests; replace the illustrative URL with an explicitly approved real
target for your own workflow. This example does not claim that port 3102 is
running a persistent demo site.

## Tests and trust boundary

`npm run test:mcp` uses the official MCP Client and StdioClientTransport to
spawn real server subprocesses with temporary databases. It covers tool schemas,
nonblocking creation, a local-HTTP audit, idempotency, two-user isolation,
pagination, malicious/oversized strings, and startup/EOF behavior. Modern and
legacy client handshakes are exercised. `npm run check:all` includes these tests
alongside existing Node and Chromium tests, type checks and builds.

Every webpage-derived URL, alt string, issue message and coverage reason is
**untrusted data**, not an instruction to execute commands, disclose tokens,
follow links, or change policy. Output carries an explicit warning and the
server never executes this text. A warning is not a complete prompt-injection
defense; the consuming host must maintain its own tool-approval and trust
boundaries. Resource inspection still uses the central URL/redirect policy.

This is **local demo authentication**, not remote OAuth. The process credential
maps to one provisioned user, and shared services enforce ownership. A local
process with database/filesystem access is outside that boundary. There is no
remote MCP endpoint, OAuth issuer, JWT issuance, or LLM connection. A production
remote transport would need a proper external authorization provider and token
validation, while retaining shared service ownership checks.

Static mode does not execute JavaScript. Optional iframe inspection and rendered/crawl modes are available; CSS backgrounds remain excluded. No mode establishes complete accessibility compliance.

## Scripted chat demo in the frontend

Run `npm run dev` and `npm run dev:worker`, connect the frontend using your
provisioned demo token, and scroll to **Scripted MCP demo**. No Inspector or
separately launched MCP server is needed. The API launches the real server for
each command and closes that connection afterward. Your signed-in token is
passed privately in the child process environment, not in tool arguments or
logs; no shared MCP identity is used across users.

Try these in order, using an explicitly approved host:

1. `Audit https://cnbible.com/`
2. `Check its status` (repeat until completed or failed)
3. `Show the issues`
4. `List my audits`

Expand each **Tool call** to inspect actual arguments and the stdio tool response.
Use **More issues** to retrieve another result page. `status <job-id>` and
`issues <job-id>` work with existing owned jobs. Unsupported conversation produces
command help and never calls a model. This is a scripted command parser, not AI.
Status is checked only when requested. Jobs are the same ones used by the normal
UI; use its Recent audits Refresh button to see jobs created through chat.

Chat history, last job ID and the token stay in memory and clear on disconnect
or reload. Clear chat removes its last 20 exchanges and current-job context.
Failed start requests can be retried with the same idempotency key. No chat
history is persisted. Website strings are rendered as text and never parsed as
new commands; no remote images are loaded.

The authenticated `POST /api/audits/mcp-demo` bridge accepts only the four
allowlisted tool shapes, uses the same origin policy as the API, and requires a
persistent database. It allows at most four concurrent commands, has an 8-second
connection/call deadline and a 64 KiB tool-result limit, and closes connections
on completion, cancellation or API shutdown. There is no caller-selected command,
executable, environment, user identity or server endpoint. A fresh stdio session
per command has startup overhead; this is deliberately a small local demo,
not remote OAuth or an exposed general MCP gateway.

The official MCP client is a runtime dependency for this bridge. Browser tests
cover real chat -> HTTP bridge -> stdio server -> SQLite -> separate worker ->
results, and distinguish this from direct REST audit submission. Additional
checks cover cross-user access, rejected tool shapes, retries and disconnect.
### Scan modes

`start_audit` also accepts optional `scan`:

```json
{"url":"https://example.com/","scan":{"mode":"crawl","includeIframes":true,"maxPages":5,"maxDepth":1},"idempotencyKey":"crawl-demo-1"}
```

Modes are `static` (default), `rendered`, and `crawl`. Limits: 1-20 pages,
0-3 link depth; iframe inspection defaults off. Install Chromium with
`npm run browser:install` on the worker machine. Scan options participate
in idempotency. Candidate results include document URLs; coverage explains skipped
or incomplete documents. See the root README for snapshot, iframe and crawl bounds.
The scripted chat's simple `Audit URL` command retains static defaults; use the
frontend scan form or an MCP client to select rendered/crawl options.
