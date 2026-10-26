# Five-minute demo script

**Draft for review. Do not record yet.** The linked video is the earlier demo.

## Prepare

Run the [README quick start](../README.md#quick-start-deterministic-demo).
Open the app at http://127.0.0.1:5173 and fixture at http://127.0.0.1:3105/.
Confirm fixture mode and automatic sign-in. Use **Static page**, iframe inspection
off. Rehearse and run `npm run check:all` before recording.

## 0:00–0:45 — The problem

**Show:** Scroll through the fixture's campsite, broken image, and coastal image.

**Say:** “Before publishing, are your images broken, unnecessarily large, or
missing text alternatives? Website Image Audit checks a URL and gives you a
review list. This local example deliberately contains all three problems.”

## 0:45–1:30 — Scan the page

**Show:** Narrow the fixture below 768 px, then widen it to show the responsive
image switch. Submit `http://127.0.0.1:3105/` in the app; wait for completion.

**Say:** “Responsive pages can reference several versions of an image. The scan
records candidates, not a claim that all were displayed. Here it finds five
unique resources, six image occurrences, and seven candidate rows.”

## 1:30–3:00 — Review actionable findings

**Show:** Select **Failed resources**, **Oversized images**, then **Missing alt**.
Pause on each finding. Return to **All candidates** and point out empty alt.

**Say:** “The 404 identifies a URL to correct or a file to restore. The coastal
image exceeds the 500 KB threshold: a file to review for compression or resizing.
Its size is deliberately padded for this demo; display dimensions alone do not
make a file large. Missing alt identifies an image element needing a text
alternative review. Empty alt may correctly mark decoration and is not an error.
These checks guide fixes; they do not measure page speed or certify accessibility.”

## 3:00–3:30 — Take the findings away

**Show:** Download CSV and point to JSON export.

**Say:** “Export the inventory for follow-up, make changes to your website, then
scan again. The app reports findings; it does not change the website for you.”

## 3:30–4:15 — Use the same workflow through MCP

**Show:** In MCP chat, enter `Audit http://127.0.0.1:3105/`, select **Check its
status**, then **Show the issues**. Check again if still running; expand a trace.

**Say:** “Compatible AI assistants can start an audit, check status, and retrieve
findings through MCP. This chat demonstrates real tool calls with a simple
command parser, not an AI model. No LLM key is needed.”

## 4:15–5:00 — Design and direction

**Show:** Briefly show the README architecture diagram, then return to results.

**Say:** “The UI and MCP share services and ownership checks. SQLite persists
jobs; a separate worker uses leases to recover abandoned work and reject stale
writes. Current checks focus on broken images, file size, and alt attributes.
I plan to add inspections incrementally toward near-complete coverage within a
clearly defined scope. That is the roadmap, not today's claim. The value today
is a concrete list of image issues to review before launch or after changes.”

## Presenter notes

- Expect one HTTP 404 resource, one oversized resource, one missing-alt occurrence,
  and one empty-alt occurrence. The broken image makes coverage partial; the job completes.
- Pause and scroll naturally. A quick scan may finish before running progress is visible.
- Show pictures in the fixture tab; the app does not load remote image previews.
- If setup fails, use [operations](OPERATIONS.md). Do not substitute a public site
  and claim deterministic counts. Optional rendering/iframe demos are outside this script.
