import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { demoHelp, parseDemoCommand } from './demo-command.js';
import type { DemoCall } from './demo-command.js';

interface Reply {
  transport: 'stdio';
  tool: string;
  result: {
    isError?: boolean;
    structuredContent?: {
      ok: boolean;
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    };
    content?: Array<{ type: string; text?: string }>;
  };
}
interface Entry {
  id: number;
  command: string;
  call: DemoCall | null;
  summary: string;
  reply?: Reply;
  failed?: boolean;
}
function summarize(reply: Reply) {
  const envelope = reply.result.structuredContent;
  if (!envelope || !envelope.ok)
    return envelope?.error?.message ?? 'MCP rejected the call. See the protocol response.';
  const data = envelope.data ?? {};
  if (reply.tool === 'start_audit')
    return (
      'Audit ' + String(data['id']) + ' is ' + String(data['state']) + '. Check its status next.'
    );
  if (reply.tool === 'get_audit_status') {
    const job = data['job'] as {
      state: string;
      progress: { inspected: number; total: number | null };
    };
    return (
      'Status: ' +
      job.state +
      '. Inspected ' +
      job.progress.inspected +
      (job.progress.total === null ? '' : ' of ' + job.progress.total) +
      ' resources.'
    );
  }
  if (reply.tool === 'list_audits')
    return (
      'Found ' +
      (data['jobs'] as unknown[]).length +
      ' recent audits. Expand the response for job IDs.'
    );
  if (!data['available'])
    return 'Results are not available yet. Check status later; the separate worker must be running.';
  const summary = data['summary'] as {
    uniqueResources: number;
    htmlOccurrences: number;
    failedResources: number;
    missingAlt: number;
    emptyAlt: number;
    coverageComplete: boolean;
  };
  return (
    summary.uniqueResources +
    ' unique resources across ' +
    summary.htmlOccurrences +
    ' HTML occurrences. ' +
    summary.failedResources +
    ' failed resources; ' +
    summary.missingAlt +
    ' missing alt; ' +
    summary.emptyAlt +
    ' empty alt (possibly decorative). ' +
    (summary.coverageComplete ? 'Static scan complete.' : 'Partial coverage.') +
    ' Showing ' +
    (data['items'] as unknown[]).length +
    ' issues.'
  );
}
export function McpChat({ token }: { token: string }) {
  const [command, setCommand] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ command: string; key: string } | null>(null);
  const serial = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [entries, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  async function execute(text: string, supplied?: DemoCall) {
    if (controller.current) return;
    if (pending.current?.command !== text)
      pending.current = { command: text, key: crypto.randomUUID() };
    let call: DemoCall;
    try {
      call = supplied ?? parseDemoCommand(text, lastId, pending.current.key);
    } catch (error) {
      setEntries((items) => [
        ...items.slice(-19),
        {
          id: ++serial.current,
          command: text,
          call: null,
          summary: error instanceof Error ? error.message : demoHelp,
          failed: true,
        },
      ]);
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    try {
      const response = await fetch('/api/audits/mcp-demo', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(call),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(12_000)]),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message: string } };
        throw new Error(body.error?.message ?? 'Demo request failed.');
      }
      const reply = (await response.json()) as Reply;
      if (current.signal.aborted) return;
      const payload = reply.result.structuredContent;
      if (payload?.ok) {
        pending.current = null;
        if (call.name === 'start_audit') setLastId(String(payload.data?.['id']));
        else if ('id' in call.arguments) setLastId(call.arguments.id);
      }
      setEntries((items) => [
        ...items.slice(-19),
        {
          id: ++serial.current,
          command: text,
          call,
          summary: summarize(reply),
          reply,
          failed: reply.result.isError ?? false,
        },
      ]);
      setCommand('');
    } catch (error) {
      if (!current.signal.aborted)
        setEntries((items) => [
          ...items.slice(-19),
          {
            id: ++serial.current,
            command: text,
            call,
            summary: error instanceof Error ? error.message : 'Request failed.',
            failed: true,
          },
        ]);
    } finally {
      if (!current.signal.aborted) setBusy(false);
      controller.current = null;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void execute(command);
  }
  return (
    <section className="panel mcp-chat" aria-labelledby="mcp-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LIVE TOOL CALLS / LOCAL STDIO</p>
          <h2 id="mcp-title">MCP chat</h2>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setEntries([]);
            setLastId(null);
            setCommand('');
            pending.current = null;
          }}
        >
          Clear chat
        </button>
      </div>
      <p className="muted">
        A small command parser, not an AI model. Calls the real MCP server through a local stdio
        client. No LLM API key. Webpage content is untrusted data; it is never interpreted as
        commands.
      </p>
      <div
        ref={log}
        role="log"
        aria-label="MCP demo conversation"
        aria-live="polite"
        className="chat-log"
      >
        {!entries.length && (
          <p className="empty">Start with “audit https://example.com/” using an approved host.</p>
        )}
        {entries.map((entry) => (
          <article key={entry.id} className="chat-entry">
            <p>
              <strong>You:</strong> {entry.command}
            </p>
            <p className={entry.failed ? 'error' : ''}>
              <strong>Mcp:</strong> {entry.summary}
            </p>
            {entry.call && (
              <details>
                <summary>
                  Tool call: {entry.call.name}
                  {entry.reply ? ' · stdio response' : ' · request failed'}
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      request: entry.call,
                      ...(entry.reply ? { response: entry.reply.result } : {}),
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
            {entry.failed && entry.call && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void execute(entry.command, entry.call!);
                }}
              >
                Retry command
              </button>
            )}
            {entry.reply?.result.structuredContent?.ok &&
              entry.call?.name === 'get_audit_results' &&
              typeof entry.reply.result.structuredContent.data?.['nextOffset'] === 'number' && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (entry.call?.name === 'get_audit_results')
                      void execute('More issues', {
                        ...entry.call,
                        arguments: {
                          ...entry.call.arguments,
                          offset: entry.reply!.result.structuredContent!.data![
                            'nextOffset'
                          ] as number,
                        },
                      });
                  }}
                >
                  More issues
                </button>
              )}
          </article>
        ))}
      </div>
      <p className="muted">{demoHelp}</p>
      <form onSubmit={submit}>
        <label htmlFor="mcp-command">Chat command</label>
        <div className="input-row">
          <input
            id="mcp-command"
            value={command}
            maxLength={2200}
            required
            disabled={busy}
            autoComplete="off"
            placeholder="audit https://example.com/"
            onChange={(event) => setCommand(event.target.value)}
          />
          <button disabled={busy}>{busy ? 'Calling MCP…' : 'Send command'}</button>
        </div>
      </form>
      <p role="status" className="muted">
        {busy
          ? 'Opening stdio connection and calling the tool…'
          : 'Ready. Status is checked only when requested. The last 20 exchanges stay in memory.'}
      </p>
      <div className="actions">
        {['Check its status', 'Show the issues', 'List my audits'].map((text) => (
          <button
            key={text}
            className="secondary"
            disabled={busy}
            onClick={() => {
              void execute(text);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      {lastId && (
        <p className="muted">
          Current audit: <code>{lastId}</code>
        </p>
      )}
    </section>
  );
}
