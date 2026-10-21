import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Job } from '../shared/jobs.js';
import { isActive, request } from './client.js';
import type { ResultsResponse } from './client.js';
import { usePolling } from './usePolling.js';
import { Results } from './Results.js';
import { defaultScan } from '../shared/scan.js';
import type { ScanOptions } from '../shared/scan.js';
import { McpChat } from './McpChat.js';

const activeList = (value: { jobs: Job[] }) => value.jobs.some(isActive);
const activeDetail = (value: { job: Job; results: ResultsResponse | null }) => isActive(value.job);
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to complete request. Please retry.';
const date = (time: number) => new Date(time).toLocaleString();

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [fixture, setFixture] = useState(false);
  useEffect(() => { const controller = new AbortController(); void fetch('/api/health', { signal: controller.signal }).then(r => r.json()).then((v: { mode?: string }) => { if (!controller.signal.aborted) setFixture(v.mode === 'fixture'); }).catch(() => {}); return () => controller.abort(); }, []);
  return <main>
    <header><span className="brand">WIA<span className="brand-name"> / Website Image Audit</span></span>
      <div className="actions"><span className="local-dot">LOCAL DEMO</span>{token && <button className="secondary" onClick={() => setToken(null)}>Disconnect</button>}</div>
    </header>
    {fixture && <p className="notice" role="status"><strong>FIXTURE MODE</strong> · Isolated demo database. Only http://127.0.0.1:3105 is approved.</p>}
    <section className="intro"><p className="eyebrow">LOOK CLOSER. LOAD LIGHTER.</p>
      <h1>A clearer picture<br />of your images<span className="accent">.</span></h1>
      <p className="description">Inspect image candidates, spot delivery issues, and review text alternatives.</p>
    </section>
    {token === null ? <Connection onConnect={setToken} /> : <><Workspace token={token} /><McpChat token={token} /></>}
    <footer>Static or rendered scans · Local processing · No remote image previews<br />
      Demo authentication. Your token stays in memory and is cleared on disconnect or reload.</footer>
  </main>;
}
function Connection({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const credential = value.trim();
    if (!credential) { setError('Enter a demo token.'); return; }
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setError('');
    try {
      await request<{ jobs: Job[] }>(credential, '?limit=1', current.signal);
      if (!current.signal.aborted) { setValue(''); onConnect(credential); }
    } catch (cause) {
      if (!current.signal.aborted) setError(message(cause).replace('Disconnect and enter', 'Enter'));
    } finally { if (!current.signal.aborted) setBusy(false); }
  }
  return <section className="panel connection" aria-labelledby="connect-title">
    <p className="eyebrow">01 / CONNECT</p><h2 id="connect-title">Connect to your local workspace</h2>
    <p className="muted">Enter a provisioned demo token. It is sent only to the local API and is never saved in browser storage.</p>
    <form onSubmit={(event) => { void connect(event); }}>
      <label htmlFor="token">Local demo token</label>
      <div className="input-row"><input id="token" type="password" autoComplete="off" spellCheck={false}
        value={value} onChange={(event) => setValue(event.target.value)} required disabled={busy} aria-describedby="token-help" />
        <button disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button></div>
      <p id="token-help" className="muted">Generate one in the project terminal with <code>npm run auth:token -- your-user-id</code>.</p>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </section>;
}
function Workspace({ token }: { token: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [url, setUrl] = useState('');
  const [scan, setScan] = useState<ScanOptions>({ ...defaultScan });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ url: string; key: string } | null>(null);
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const target = url.trim();
    try {
      const parsed = new URL(target);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch { setError('Enter an HTTP or HTTPS URL without embedded credentials.'); return; }
    // Retain the key after an uncertain failure; retrying the same URL cannot duplicate a job.
    const payloadKey = JSON.stringify({ url: target, scan });
    if (pending.current?.url !== payloadKey) pending.current = { url: payloadKey, key: crypto.randomUUID() };
    const controller = new AbortController();
    submission.current = controller;
    setBusy(true); setError('');
    try {
      const created = await request<{ id: string }>(token, '', controller.signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
        body: JSON.stringify({ url: target, scan }),
      });
      if (controller.signal.aborted) return;
      pending.current = null;
      setSelected(created.id); setRevision((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <>
    <section className="panel" aria-labelledby="new-title">
      <p className="eyebrow">AUDIT IMAGES</p><h2 id="new-title">Request an audit</h2>
      <form onSubmit={(event) => { void submit(event); }}>
        <label htmlFor="page-url">Webpage URL</label>
        <div className="input-row"><input id="page-url" type="url" placeholder="https://example.com/page" autoComplete="off"
          required maxLength={2048} value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} aria-describedby="scan-limits" />
          <button disabled={busy}>{busy ? 'Submitting…' : 'Start audit'}</button></div>
        <label htmlFor="scan-mode">Scan mode</label>
        <select id="scan-mode" disabled={busy} value={scan.mode} onChange={e => setScan({ ...scan, mode: e.target.value as ScanOptions['mode'] })}>
          <option value="static">Static page</option><option value="rendered">Rendered page (JavaScript)</option><option value="crawl">Rendered site crawl</option>
        </select>
        <label className="checkbox-label"><input type="checkbox" checked={scan.includeIframes} disabled={busy} onChange={e => setScan({ ...scan, includeIframes: e.target.checked })} /> Inspect iframe documents</label>
        {scan.mode === 'crawl' && <div className="actions">
          <label>Maximum pages <input type="number" min="1" max="20" required disabled={busy} value={scan.maxPages} onChange={e => setScan({ ...scan, maxPages: Number(e.target.value) })} /></label>
          <label>Maximum link depth <input type="number" min="0" max="3" required disabled={busy} value={scan.maxDepth} onChange={e => setScan({ ...scan, maxDepth: Number(e.target.value) })} /></label>
        </div>}
        <p className="muted" id="scan-limits">Rendered scans execute JavaScript and take a timed DOM snapshot. Crawls follow same-origin links, up to 20 pages and depth 3.
          Iframes are inspected independently, up to 10 documents and depth 2. No login, clicks, or infinite scrolling.
          Page and image hosts must be explicitly approved on the server. Default limits: 100 unique resources, 500 image occurrences,
          2 MB of HTML and 10 MB per image; images above 500 KB are flagged. Limits may leave partial results.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>
    <div className="workspace">
      <Recent key={revision} token={token} selected={selected} onSelect={setSelected} />
      {selected ? <Detail key={selected} id={selected} token={token} onClose={() => setSelected(null)} />
        : <section className="panel selection-empty"><p className="eyebrow">REVIEW AUDIT RESULTS</p><h2>Your findings, in focus</h2>
          <p className="muted">Start an audit or select a recent one to inspect its progress and image inventory.</p></section>}
    </div>
  </>;
}
function Recent({ token, selected, onSelect }: { token: string; selected: string | null; onSelect: (id: string) => void }) {
  const load = useCallback((signal: AbortSignal) => request<{ jobs: Job[] }>(token, '?limit=20', signal), [token]);
  const { data, loading, error, refresh } = usePolling(load, activeList);
  return <section className="panel recent" aria-labelledby="recent-title">
    <div className="section-heading"><h2 id="recent-title">Recent audits</h2><button className="secondary" onClick={refresh} disabled={loading}>Refresh</button></div>
    <p className="muted">Your 20 most recent jobs.</p>
    {loading && <p role="status">Loading audits…</p>}
    {error && <div role="alert" className="error">{error} Polling paused. Use Refresh to retry.</div>}
    {data?.jobs.length === 0 && <p className="empty">No audits yet. Submit your first page above.</p>}
    <ul className="job-list">{data?.jobs.map((job) => <li key={job.id}>
      <button className={'job-button' + (selected === job.id ? ' selected' : '')} onClick={() => onSelect(job.id)} aria-pressed={selected === job.id}>
        <span className={'badge ' + job.state}>{job.state}</span><span className="job-url">{job.url}</span>
        <time dateTime={new Date(job.createdAt).toISOString()}>{date(job.createdAt)}</time>
      </button>
    </li>)}</ul>
  </section>;
}
function Detail({ token, id, onClose }: { token: string; id: string; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const load = useCallback(async (signal: AbortSignal) => {
    const job = await request<Job>(token, '/' + encodeURIComponent(id), signal);
    const results = isActive(job) ? null : await request<ResultsResponse>(token, '/' + encodeURIComponent(id) + '/results', signal);
    return { job, results };
  }, [token, id]);
  const { data, error, loading, refresh } = usePolling(load, activeDetail);
  const job = data?.job;
  return <section className="panel detail" aria-labelledby="detail-title">
    <div className="section-heading"><h2 id="detail-title" ref={heading} tabIndex={-1}>Audit detail</h2>
      <button className="secondary" onClick={onClose}>Close detail</button></div>
    {loading && <p role="status">Loading audit…</p>}
    {error && <div role="alert" className="error"><p>{error} Polling paused.</p><button onClick={refresh}>Retry details</button></div>}
    {job && <>
      <p className="detail-url">{job.url}</p><p className="muted">Created {date(job.createdAt)} · Attempt {job.attempts} of {job.maxAttempts}</p>
      <div role="status" className="progress-status"><span className={'badge ' + job.state}>{job.state}</span>
        <span>{job.progress.phase.replaceAll('-', ' ')} · {job.progress.inspected}{job.progress.total === null ? '' : ' / ' + job.progress.total} resources inspected</span></div>
      {isActive(job) && <><progress aria-label="Image inspection progress" {...(job.progress.total && job.progress.total > 0 ? { value: job.progress.inspected, max: job.progress.total } : {})} />
        <p className="muted">{job.state === 'queued' ? 'Waiting for the worker. Make sure npm run dev:worker is running.' : 'Inspecting image metadata. Results are published when the attempt finishes.'}</p></>}
      {job.lastError && <p className="notice warning">{job.state === 'failed' ? 'Audit failed: ' : 'Previous attempt: '}{job.lastError.message}</p>}
      {data?.results?.result ? <Results id={id} result={data.results.result} />
        : !isActive(job) && <p className="empty">No image results are available for this audit.</p>}
    </>}
  </section>;
}
