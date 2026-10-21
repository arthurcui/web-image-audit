import { useCallback } from 'react';
import type { AuditJob } from '../shared/jobs.js';
import { isActive, requestAuditApi } from './client.js';
import { usePolling } from './usePolling.js';
import { formatDate } from './format.js';
const activeList = (value: { jobs: AuditJob[] }) => value.jobs.some(isActive);

export function RecentAudits({
  token,
  selected,
  onSelect,
}: {
  token: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => requestAuditApi<{ jobs: AuditJob[] }>(token, '?limit=20', signal),
    [token],
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
      <p className="muted">Your 20 most recent jobs.</p>
      {loading && <p role="status">Loading audits…</p>}
      {error && (
        <div role="alert" className="error">
          {error} Polling paused. Use Refresh to retry.
        </div>
      )}
      {data?.jobs.length === 0 && (
        <p className="empty">No audits yet. Submit your first page above.</p>
      )}
      <ul className="job-list">
        {data?.jobs.map((job) => (
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
    </section>
  );
}
