import { createAuditSchema } from '../shared/inputs.js';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { defaultScan } from '../shared/scan.js';
import type { ScanOptions } from '../shared/scan.js';
import { requestAuditApi } from './client.js';
import { errorMessage } from './format.js';

export function AuditForm({
  token,
  onCreated,
}: {
  token: string;
  onCreated: (id: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [scan, setScan] = useState<ScanOptions>({ ...defaultScan });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ payloadFingerprint: string; key: string } | null>(null);
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const target = url.trim();
    const validated = createAuditSchema.safeParse({ url: target, scan });
    if (!validated.success) {
      setError(validated.error.issues[0]?.message ?? 'Invalid audit input');
      return;
    }
    // Retain the key after an uncertain failure; retrying the same URL and scan options cannot duplicate a job.
    const payloadFingerprint = JSON.stringify(validated.data);
    if (pending.current?.payloadFingerprint !== payloadFingerprint)
      pending.current = { payloadFingerprint, key: crypto.randomUUID() };
    const controller = new AbortController();
    submission.current = controller;
    setBusy(true);
    setError('');
    try {
      const created = await requestAuditApi<{ id: string }>(token, '', controller.signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
        body: JSON.stringify({ url: target, scan }),
      });
      if (controller.signal.aborted) return;
      pending.current = null;
      onCreated(created.id);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="new-title">
      <p className="eyebrow">AUDIT IMAGES</p>
      <h2 id="new-title">Request an audit</h2>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label htmlFor="page-url">Webpage URL</label>
        <div className="input-row">
          <input
            id="page-url"
            type="url"
            placeholder="https://example.com/page"
            autoComplete="off"
            required
            maxLength={2048}
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
            aria-describedby="scan-limits"
          />
          <button disabled={busy}>{busy ? 'Submitting…' : 'Start audit'}</button>
        </div>
        <label htmlFor="scan-mode">Scan mode</label>
        <select
          id="scan-mode"
          disabled={busy}
          value={scan.mode}
          onChange={(e) => setScan({ ...scan, mode: e.target.value as ScanOptions['mode'] })}
        >
          <option value="static">Static page</option>
          <option value="rendered">Rendered page (JavaScript)</option>
          <option value="crawl">Rendered site crawl</option>
        </select>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={scan.includeIframes}
            disabled={busy}
            onChange={(e) => setScan({ ...scan, includeIframes: e.target.checked })}
          />{' '}
          Inspect iframe documents
        </label>
        {scan.mode === 'crawl' && (
          <div className="actions">
            <label>
              Maximum pages{' '}
              <input
                type="number"
                min="1"
                max="20"
                required
                disabled={busy}
                value={scan.maxPages}
                onChange={(e) => setScan({ ...scan, maxPages: Number(e.target.value) })}
              />
            </label>
            <label>
              Maximum link depth{' '}
              <input
                type="number"
                min="0"
                max="3"
                required
                disabled={busy}
                value={scan.maxDepth}
                onChange={(e) => setScan({ ...scan, maxDepth: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <p className="muted" id="scan-limits">
          Rendered scans execute JavaScript and take a timed DOM snapshot. Crawls follow same-origin
          links, up to 20 pages and depth 3. Iframes are inspected independently, up to 10 documents
          and depth 2. No login, clicks, or infinite scrolling. Page and image hosts must be
          explicitly approved on the server. Default limits: 100 unique resources, 500 image
          occurrences, 2 MB of HTML and 10 MB per image; images above 500 KB are flagged. Limits may
          leave partial results.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
