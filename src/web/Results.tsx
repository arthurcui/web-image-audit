import { useMemo, useState } from 'react';
import type { AuditResult } from '../application/audit/types.js';
import { altLabel, byteLabel, download, inventory, outcome, toCsv } from './inventory.js';

export function Results({ result, id }: { result: AuditResult; id: string }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => inventory(result), [result]);
  const filtered = rows.filter((row) => filter === 'all'
    || (filter === 'failed' && row.resource?.state === 'failed')
    || (filter === 'oversized' && row.resource?.oversized)
    || (filter === 'missing' && row.occurrence.alt.state === 'missing'));
  const counts = [
    ['Unique resources', result.resources.length],
    ['HTML occurrences', result.occurrences.length],
    ['Failed resources', result.resources.filter((resource) => resource.state === 'failed').length],
    ['Oversized resources', result.resources.filter((resource) => resource.oversized).length],
    ['Missing alt', result.occurrences.filter((occurrence) => occurrence.alt.state === 'missing').length],
  ] as const;
  return <>
    <dl className="metrics">{counts.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    <div className={result.coverage.complete ? 'notice' : 'notice warning'}>
      <strong>{result.coverage.complete ? 'Static inspection complete' : 'Partial coverage'}</strong>
      <p>Page: {result.page.status ? 'HTTP ' + result.page.status : result.page.state}{result.page.message ? ' · ' + result.page.message : ''}</p>
      {!result.coverage.complete && <ul>{result.coverage.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    </div>
    <div className="section-heading"><h3>Image inventory</h3><div className="actions">
      <button className="secondary" onClick={() => download('audit-' + id + '.json', JSON.stringify(result, null, 2), 'application/json')}>Export JSON</button>
      <button className="secondary" onClick={() => download('audit-' + id + '.csv', toCsv(result), 'text/csv;charset=utf-8')}>Export CSV</button>
    </div></div>
    <p className="muted">Each row is a candidate for one HTML image occurrence; shared resources may appear more than once.
      Responsive and lazy candidates are possibilities, not proof they were displayed. Exports include the full inventory.</p>
    <p className="muted"><strong>Missing alt</strong> means no alt attribute. <strong>Empty alt</strong> may intentionally mark a decorative image and is not automatically an error.
      This scan does not establish accessibility compliance. Image previews are not loaded.</p>
    <label className="filter">Filter inventory
      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">All candidates</option><option value="failed">Failed resources</option>
        <option value="oversized">Oversized images</option><option value="missing">Missing alt</option>
      </select>
    </label>
    <p role="status" className="muted">{filtered.length} of {rows.length} candidate rows</p>
    {filtered.length === 0 ? <p className="empty">{rows.length === 0 ? 'No image occurrences found in the static HTML.' : 'No candidates match this filter.'}</p>
      : <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable image inventory">
        <table><caption className="sr-only">Image candidates and inspection outcomes</caption>
          <thead><tr>{['Image URL', 'Source attribute', 'HTTP outcome', 'Content type', 'Byte size', 'Alt-text status', 'Issues'].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{filtered.map((row) => <tr key={row.key}>
            <td className="url-cell">{row.candidate?.url ?? row.candidate?.rawUrl ?? 'No image source'}
              <small>{row.occurrence.id}{row.resource ? ' · ' + row.resource.id : ''}</small>
              {row.resource && row.resource.url !== row.resource.requestedUrl && <small>Final URL: {row.resource.url}</small>}</td>
            <td>{row.candidate ? <><code>{row.candidate.element}[{row.candidate.attribute}]</code><small>{row.candidate.role}
              {row.candidate.descriptor ? ' · ' + row.candidate.descriptor : ''}{row.candidate.media ? ' · ' + row.candidate.media : ''}</small></> : '—'}</td>
            <td>{outcome(row)}</td><td>{row.resource?.contentType ?? '—'}</td><td>{byteLabel(row.resource)}
              {row.resource && !row.resource.bytesComplete && <small>Lower bound; incomplete</small>}</td>
            <td>{altLabel(row.occurrence)}</td><td>{row.issues.length ? <ul>{row.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : 'None reported'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </>;
}
