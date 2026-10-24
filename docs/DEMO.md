# Five-minute demonstration

## Before the meeting (not part of the five minutes)

Run the README quick start, including browser installation.
Stop normal app processes to free ports; run `npm run demo`. Confirm the frontend
FIXTURE MODE banner and the labeled fixture at http://127.0.0.1:3105/.
Open the frontend; fixture mode signs in automatically as the shared demo user.
Run `npm run check:all` ahead of time. Keep worker logs visible in a second pane.
Do not use a live public site for the core demo. No LLM key is needed.

## 0:00–0:40 — Problem and shape

“This is an image inventory and delivery audit, not an accessibility certification.
One repository has REST, UI, worker and MCP entry points. SQLite persists the job;
the request does not wait for network inspection.” Show the README diagram.

## 0:40–1:40 — Submit and explain results

Submit http://127.0.0.1:3105/ as Static page, frames off. Wait for completed.
Expected: 5 resources, 6 occurrences, 7 candidates. Point out the shared image
with different alt attributes, sunset responsive fallback, wide daylight source,
404 and large coastal SVG. Captions sit outside the images; cards provide spacing. Resize the fixture below/above 768 px to show the responsive switch; the oversized image displays at up to 1200 x 600.
“One broken resource does not make the job fail; it makes coverage partial.”

## 1:40–2:30 — Review without overclaiming

Filter missing alt (one occurrence), then oversized (one resource), then failed
(one 404). Empty alt is labeled possibly decorative. Show CSV/JSON export; explain
CSV formula escaping and no automatic remote previews. Restore All candidates.

## 2:30–3:40 — MCP workflow

In MCP chat, type `Audit http://127.0.0.1:3105/`, then `Check its status`,
then `Show the issues`. If queued/running, explicitly check again. Expand tool
traces. “This is a scripted UI calling a real official-SDK stdio MCP client/server,
not an LLM. The configured identity reaches the same ownership service.”
Explain that start is asynchronous and results are bounded/paginated.

## 3:40–4:25 — Failure and consistency model

Show audit IDs in structured worker logs. Explain atomic claims, heartbeats,
expired-lease recovery and fencing stale writes. “Execution is at least once;
only the current lease holder may publish. Idempotency is scoped per user.”
Do not kill processes live: crash-recovery tests provide repeatable evidence.

## 4:25–5:00 — Trade-offs and verification

Show architecture decisions and the test commands. Explain SQLite is intentional
for a local demo; hosted databases and external queues add operational scope.
Optional if time: rendered `/dynamic.html` with frames enabled discovers the
JavaScript image and frame image. Be explicit about snapshot/parent-frame limits.
Finish with what is verified and what would change before public hosting.

## Recovery

If a port is occupied, stop the existing app before re-running demo. If automatic
sign-in fails, check that the fixture API is running and select Connect to demo.
Manual API/MCP clients can use `demo:token -- fixture-demo`; normal-mode tokens
belong to a different database.
If rendering cannot launch, run `browser:install`; the core static demonstration
still works. Historical failed audits remain failed; submit a new job after repair.
Never claim a public website or browser-dependent result has deterministic counts.
