# Local MCP server

Four stdio tools expose the audit workflow through the official TypeScript SDK.
The server queues work; run the separate worker against the same database and
approved hosts. API/frontend processes are optional. No LLM key is required.

## Connect a client

Complete [normal-mode setup](../README.md#normal-mode-and-configuration), then
run `npm run build` and provision a token with `npm run auth:token -- <user>`.
Supply it privately as `AUDIT_DEMO_TOKEN` in the client's secret/environment
configuration, never in tool arguments or a committed file.

For clients using `mcpServers`, adjust these absolute paths:

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

The client must pass `AUDIT_DEMO_TOKEN` to its child process; an unrelated shell's
environment is not automatically inherited. Restart the connection after changes.
Use `node` directly: ordinary npm banners would corrupt protocol stdout.

For fixture mode, run `npm run demo`, provision with
`npm run demo:token -- fixture-demo`, and launch `node` with the absolute path to
`scripts/demo.mjs` followed by `mcp`, using the repository as working directory.

For a manual normal-mode launch in PowerShell:

```powershell
$secret = Read-Host 'Demo token' -AsSecureString
$env:AUDIT_DEMO_TOKEN = [System.Net.NetworkCredential]::new('', $secret).Password
node --env-file-if-exists=.env dist/server/mcp/main.js
# After exit:
Remove-Item Env:AUDIT_DEMO_TOKEN
Remove-Variable secret
```

It waits for JSON-RPC on stdin, not typed chat. Missing/invalid credentials exit
with code 1 and a generic stderr diagnostic. EOF or termination closes resources.

## Tools

| Tool | Inputs | Result |
| --- | --- | --- |
| `start_audit` | url; optional scan, idempotencyKey | id, state, replayed immediately |
| `get_audit_status` | id | state, progress, timestamps, attempts, last error |
| `get_audit_results` | id; section (default issues), cursor, limit | summary and a bounded page; available=false until published |
| `list_audits` | cursor, limit | owned jobs and page metadata |

Unknown inputs are rejected; outputs are schema-validated. Success is
`{ok:true,data:...,error:null}`. Application failures set `isError:true` with
`{ok:false,data:null,error:{code,message}}`; SDK validation uses its tool-error
format. Foreign and missing jobs both return `job_not_found`.

Scan settings and per-user idempotency follow the [shared creation semantics](API.md#submit-and-inspect).
The same key and normalized payload replays a job; without a key, calls create new jobs.
No tool accepts a user ID or token as proof of identity: the process credential
is resolved by the shared application service.

## Results and pagination

Sections: `summary`, `issues`, `resources`, `candidates`, `coverage`. All include
summary counts; coverage findings have stable codes and messages. Issues distinguish
image versus coverage scope. Active attempts do not expose transient snapshots.

Limits are 1–20, default 10. Follow `data.page.nextCursor` with the same id/section;
use `hasMore`, not item count. Save request cursors to revisit pages; restart on
`stale_cursor`. See [cursor behavior](API.md#pagination-and-previous-pages).

MCP-specific bounds: strings clip at 256 UTF-16 code units with `truncatedFields`;
escaped item JSON is limited to 20,000 bytes, and normal responses including text
and structured copies stay below 64 KiB. Raw HTML, bodies, and unbounded nested
candidate arrays are excluded. Use [REST exports](API.md#result-meaning-and-exports)
for full values.

## Fixture workflow

With fixture mode running, call:

```text
start_audit({"url":"http://127.0.0.1:3105/","idempotencyKey":"demo-001"})
get_audit_status({"id":"<returned-id>"})
get_audit_results({"id":"<returned-id>","section":"issues","limit":10})
```

Check status again while queued/running. A concise summary after completion:
“Five unique resources across six occurrences; one HTTP 404, one oversized
resource, and one missing-alt occurrence. One empty alt may be decorative.
Coverage is partial.” Counts describe the [local fixture](DEMO.md), not a public site.

## Scripted chat and trust boundary

The frontend's **MCP chat** accepts `Audit URL`, `Check its status`, `Show the issues`,
and `List my audits`. Expand tool traces or use **More issues**. It is a command
parser, not an AI model; status is checked only on request. History (20 exchanges),
last job ID, and token remain in memory and clear on disconnect/reload.

The authenticated API bridge spawns one short-lived stdio session per command,
privately forwarding the signed-in token. It accepts only four tool shapes, with
four concurrent calls, an eight-second deadline, and a 64 KiB result limit.
Cancellation/shutdown closes sessions. Callers cannot choose executables,
environments, identities, or endpoints. Startup overhead buys a small, isolated
session lifecycle rather than a general-purpose MCP gateway.

Webpage strings are **untrusted data**, never commands. Warning labels are not a
complete prompt-injection defense; consuming clients must enforce their own trust
and approval boundaries. Local demo authentication is not remote OAuth. A remote
service would validate credentials from an external authorization provider while
retaining shared ownership checks; local filesystem access is outside this boundary.

## Verification and SDK references

`npm run test:mcp` exercises real SDK clients/subprocesses, schemas, asynchronous
creation, ownership, idempotency, pagination, bounded strings, and startup/EOF.
`npm run test:ui` includes the chat-to-worker workflow. Installed versions live in
`package.json`; API references: [stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio),
[tools](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server),
[testing](https://ts.sdk.modelcontextprotocol.io/v2/testing).
