// Display owned audits with cursor history and active-job refresh.
type AuditCursor = string;
import { useCallback, useState } from 'react';
import type { AuditJob } from '../shared/jobs.js';
import { isActive, requestAuditApi } from './client.js';
import { usePolling } from './usePolling.js';
import { formatDate } from './format.js';
const activeList = (value: { items: AuditJob[] }) => value.items.some(isActive);

interface Props {
  token: string;
  selected: string | null;
  onSelect: (id: string) => void;
}
export function RecentAudits(props: Props) {
  const [cursors, setCursors] = useState<Array<AuditCursor | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  return (
    <RecentAuditPage
      key={JSON.stringify(cursor) ?? 'latest'}
      {...props}
      cursor={cursor}
      page={cursors.length}
      older={(next) => setCursors((current) => [...current, next])}
      newer={() => setCursors((current) => current.slice(0, -1))}
    />
  );
}
function RecentAuditPage({
  token,
  selected,
  onSelect,
  cursor,
  page,
  older,
  newer,
}: Props & {
  cursor: AuditCursor | undefined;
  page: number;
  older: (cursor: AuditCursor) => void;
  newer: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) =>
      requestAuditApi<{
        items: AuditJob[];
        page: { nextCursor: AuditCursor | null; hasMore: boolean };
      }>(token, '?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), signal),
    [token, cursor],
  );
  const { data, loading, error, refresh } = usePolling(load, activeList);
  return (
    <section className="panel recent" aria-labelledby="recent-title">
      <div className="section-heading">
        <h2 id="recent-title">Recent audits</h2>
        <button className="secondary" onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>
      <p className="muted">Page {page} · Up to 20 audits, newest first.</p>
      {loading && <p role="status">Loading audits…</p>}
      {error && (
        <div role="alert" className="error">
          {error} Polling paused. Use Refresh to retry.
        </div>
      )}
      {data?.items.length === 0 && (
        <p className="empty">No audits yet. Submit your first page above.</p>
      )}
      <ul className="job-list">
        {data?.items.map((job) => (
          <li key={job.id}>
            <button
              className={'job-button' + (selected === job.id ? ' selected' : '')}
              onClick={() => onSelect(job.id)}
              aria-pressed={selected === job.id}
            >
              <span className={'badge ' + job.state}>{job.state}</span>
              <span className="job-url">{job.url}</span>
              <time dateTime={new Date(job.createdAt).toISOString()}>
                {formatDate(job.createdAt)}
              </time>
            </button>
          </li>
        ))}
      </ul>
      <nav aria-label="Audit list pages" className="actions">
        <button onClick={newer} disabled={page === 1 || loading}>
          Newer audits
        </button>
        <button
          onClick={() => data?.page.nextCursor && older(data.page.nextCursor)}
          disabled={loading || !data?.page.nextCursor}
        >
          Older audits
        </button>
      </nav>
    </section>
  );
}
