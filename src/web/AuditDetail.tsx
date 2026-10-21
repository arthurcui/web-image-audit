import { useCallback, useEffect, useRef } from 'react';
import type { AuditJob } from '../shared/jobs.js';
import { isActive, requestAuditApi } from './client.js';
import type { ResultsResponse } from './client.js';
import { usePolling } from './usePolling.js';
import { Results } from './Results.js';
import { formatDate } from './format.js';
const activeDetail = (value: { job: AuditJob; results: ResultsResponse | null }) =>
  isActive(value.job);

export function AuditDetail({
  token,
  id,
  onClose,
}: {
  token: string;
  id: string;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const job = await requestAuditApi<AuditJob>(token, '/' + encodeURIComponent(id), signal);
      const results = isActive(job)
        ? null
        : await requestAuditApi<ResultsResponse>(
            token,
            '/' + encodeURIComponent(id) + '/results',
            signal,
          );
      return { job, results };
    },
    [token, id],
  );
  const { data, error, loading, refresh } = usePolling(load, activeDetail);
  const job = data?.job;
  return (
    <section className="panel detail" aria-labelledby="detail-title">
      <div className="section-heading">
        <h2 id="detail-title" ref={heading} tabIndex={-1}>
          Audit detail
        </h2>
        <button className="secondary" onClick={onClose}>
          Close detail
        </button>
      </div>
      {loading && <p role="status">Loading audit…</p>}
      {error && (
        <div role="alert" className="error">
          <p>{error} Polling paused.</p>
          <button onClick={refresh}>Retry details</button>
        </div>
      )}
      {job && (
        <>
          <p className="detail-url">{job.url}</p>
          <p className="muted">
            Created {formatDate(job.createdAt)} · Attempt {job.attempts} of {job.maxAttempts}
          </p>
          <div role="status" className="progress-status">
            <span className={'badge ' + job.state}>{job.state}</span>
            <span>
              {job.progress.phase.replaceAll('-', ' ')} · {job.progress.inspected}
              {job.progress.total === null ? '' : ' / ' + job.progress.total} resources inspected
            </span>
          </div>
          {isActive(job) && (
            <>
              <progress
                aria-label="Image inspection progress"
                {...(job.progress.total && job.progress.total > 0
                  ? { value: job.progress.inspected, max: job.progress.total }
                  : {})}
              />
              <p className="muted">
                {job.state === 'queued'
                  ? 'Waiting for the worker. Make sure npm run dev:worker is running.'
                  : 'Inspecting image metadata. Results are published when the attempt finishes.'}
              </p>
            </>
          )}
          {job.lastError && (
            <p className="notice warning">
              {job.state === 'failed' ? 'Audit failed: ' : 'Previous attempt: '}
              {job.lastError.message}
            </p>
          )}
          {data?.results?.result ? (
            <Results id={id} result={data.results.result} />
          ) : (
            !isActive(job) && (
              <p className="empty">No image results are available for this audit.</p>
            )
          )}
        </>
      )}
    </section>
  );
}
