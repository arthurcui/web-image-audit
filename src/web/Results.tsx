import type { InventoryPage } from '../shared/result-query.js';
import { requestAuditApi } from './client.js';
import { summarizeAudit } from '../shared/summary.js';
import { useMemo, useState, useEffect, useRef } from 'react';
import type { AuditResult } from '../shared/audit.js';
import { altLabel, byteLabel, download, inventory, outcome, toCsv } from './inventory.js';

export function Results({
  result,
  id,
  server,
}: {
  result: AuditResult;
  id: string;
  server?: {
    token: string;
    summary: ReturnType<typeof summarizeAudit>;
    attempt: number;
    coveragePreviewIncomplete: boolean;
  };
}) {
  const [filter, setFilter] = useState('all');
  const [history, setHistory] = useState<Array<string | undefined>>([undefined]);
  const cursor = history.at(-1);
  const [page, setPage] = useState<InventoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const token = server?.token;
  const attempt = server?.attempt;
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPage(null);
    void requestAuditApi<InventoryPage>(
      token,
      '/' +
        id +
        '/images?' +
        (cursor
          ? 'cursor=' + encodeURIComponent(cursor)
          : 'filter=' + (filter === 'missing' ? 'missing_alt' : filter)),
      controller.signal,
    )
      .then((value) => {
        if (value.attempt !== attempt) throw new Error('Results changed. Reload audit details.');
        if (!controller.signal.aborted) setPage(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load inventory');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, id, attempt, filter, cursor]);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  async function exportFile(format: 'json' | 'csv') {
    if (!token) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setError('');
    try {
      const response = await fetch('/api/audits/' + id + '/export?format=' + format, {
        headers: { Authorization: 'Bearer ' + token },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-' + id + '.' + format;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Export failed');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  const rows = useMemo(() => inventory(result), [result]);
  const filtered = server
    ? (page?.items ?? [])
    : rows.filter(
        (row) =>
          filter === 'all' ||
          (filter === 'failed' && row.resource?.state === 'failed') ||
          (filter === 'oversized' && row.resource?.oversized) ||
          (filter === 'missing' && row.occurrence.alt.state === 'missing'),
      );
  const summary = server?.summary ?? summarizeAudit(result);
  const counts = [
    ['Unique resources', summary.uniqueResources],
    ['HTML occurrences', summary.htmlOccurrences],
    ['Failed resources', summary.failedResources],
    ['Oversized resources', summary.oversizedResources],
    ['Missing alt', summary.missingAlt],
  ] as const;
  return (
    <>
      {result.documents && (
        <details>
          <summary>
            {result.documents.length} documents · {result.scan?.mode ?? 'static'} scan
          </summary>
          <ul>
            {result.documents.map((doc) => (
              <li key={doc.id}>
                {doc.kind}: {doc.url} · {doc.state}
                {doc.parentUrl ? ' · from ' + doc.parentUrl : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <dl className="metrics">
        {counts.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      <div className={result.coverage.complete ? 'notice' : 'notice warning'}>
        <strong>{result.coverage.complete ? 'Inspection complete' : 'Partial coverage'}</strong>
        <p>
          Page: {result.page.status ? 'HTTP ' + result.page.status : result.page.state}
          {result.page.message ? ' · ' + result.page.message : ''}
        </p>
        {!result.coverage.complete && (
          <ul>
            {result.coverage.findings.map((finding) => (
              <li key={finding.code + finding.message} data-coverage-code={finding.code}>
                {finding.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="section-heading">
        <h3>Image inventory</h3>
        <div className="actions">
          <button
            className="secondary"
            disabled={exporting}
            onClick={() =>
              server
                ? void exportFile('json')
                : download(
                    'audit-' + id + '.json',
                    JSON.stringify(result, null, 2),
                    'application/json',
                  )
            }
          >
            Export JSON
          </button>
          <button
            className="secondary"
            disabled={exporting}
            onClick={() =>
              server
                ? void exportFile('csv')
                : download('audit-' + id + '.csv', toCsv(result), 'text/csv;charset=utf-8')
            }
          >
            Export CSV
          </button>
        </div>
      </div>
      <p className="muted">
        Each row is a candidate for one HTML image occurrence; shared resources may appear more than
        once. Responsive and lazy candidates are possibilities, not proof they were displayed.
        Exports include the full inventory.
      </p>
      <p className="muted">
        <strong>Missing alt</strong> means no alt attribute. <strong>Empty alt</strong> may
        intentionally mark a decorative image and is not automatically an error. This scan does not
        establish accessibility compliance. Image previews are not loaded.
      </p>
      <label className="filter">
        Filter inventory
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setHistory([undefined]);
          }}
        >
          <option value="all">All candidates</option>
          <option value="failed">Failed resources</option>
          <option value="oversized">Oversized images</option>
          <option value="missing">Missing alt</option>
        </select>
      </label>
      <p role="status" className="muted">
        {filtered.length} of {server ? (page?.total ?? 0) : rows.length} candidate rows
      </p>
      {loading && <p role="status">Loading inventory…</p>}
      {error && <p role="alert">{error} Reload details to retry.</p>}
      {server?.coveragePreviewIncomplete && (
        <p className="notice">Coverage preview is limited; JSON export contains all findings.</p>
      )}
      {server && (
        <nav aria-label="Inventory pages">
          <button
            disabled={loading || history.length === 1}
            onClick={() => setHistory((value) => value.slice(0, -1))}
          >
            Previous images
          </button>
          <button
            disabled={loading || !page?.page.nextCursor}
            onClick={() =>
              page?.page.nextCursor && setHistory((value) => [...value, page.page.nextCursor!])
            }
          >
            Next images
          </button>
        </nav>
      )}
      {filtered.length === 0 ? (
        <p className="empty">
          {(server ? summary.htmlOccurrences : rows.length) === 0
            ? 'No image occurrences found in the inspected documents.'
            : 'No candidates match this filter.'}
        </p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable image inventory"
        >
          <table>
            <caption className="sr-only">Image candidates and inspection outcomes</caption>
            <thead>
              <tr>
                {[
                  'Image URL',
                  'Source attribute',
                  'HTTP outcome',
                  'Content type',
                  'Byte size',
                  'Alt-text status',
                  'Issues',
                ].map((heading) => (
                  <th scope="col" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.key}>
                  <td className="url-cell">
                    {row.candidate?.url ?? row.candidate?.rawUrl ?? 'No image source'}
                    <small>Document: {row.occurrence.documentUrl ?? result.page.url}</small>
                    <small>
                      {row.occurrence.id}
                      {row.resource ? ' · ' + row.resource.id : ''}
                    </small>
                    {row.resource && row.resource.url !== row.resource.requestedUrl && (
                      <small>Final URL: {row.resource.url}</small>
                    )}
                  </td>
                  <td>
                    {row.candidate ? (
                      <>
                        <code>
                          {row.candidate.element}[{row.candidate.attribute}]
                        </code>
                        <small>
                          {row.candidate.role}
                          {row.candidate.descriptor ? ' · ' + row.candidate.descriptor : ''}
                          {row.candidate.media ? ' · ' + row.candidate.media : ''}
                        </small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{outcome(row)}</td>
                  <td>{row.resource?.contentType ?? '—'}</td>
                  <td>
                    {byteLabel(row.resource)}
                    {row.resource && !row.resource.bytesComplete && (
                      <small>Lower bound; incomplete</small>
                    )}
                  </td>
                  <td>{altLabel(row.occurrence)}</td>
                  <td>
                    {row.issues.length ? (
                      <ul>
                        {row.issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : (
                      'None reported'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
