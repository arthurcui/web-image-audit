import { useCallback, useEffect, useRef } from 'react';
import type { AuditJob, AuditStatus } from '../shared/jobs.js';
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
      const job = await requestAuditApi<AuditStatus>(token, '/' + encodeURIComponent(id), signal);
      const header = job.publishedResult;
      let results: ResultsResponse | null = null;
      if (header && !isActive(job)) {
        const [documents, issues] = await Promise.all([
          requestAuditApi<{
            attempt: number;
            items: NonNullable<import('../shared/audit.js').AuditResult['documents']>;
            page: { hasMore: boolean };
          }>(token, '/' + id + '/documents?limit=100', signal),
          requestAuditApi<{
            attempt: number;
            items: Array<{ scope: string; code: string; message: string }>;
            page: { hasMore: boolean };
          }>(token, '/' + id + '/issues?limit=100', signal),
        ]);
        if (documents.attempt !== header.attempt || issues.attempt !== header.attempt)
          throw new Error('Results changed. Retry details.');
        results = {
          id,
          state: job.state,
          available: true,
          attempts: [],
          attempt: header.attempt,
          summary: header.summary,
          coveragePreviewIncomplete: issues.page.hasMore || documents.page.hasMore,
          result: {
            ...header.metadata,
            resources: [],
            occurrences: [],
            issues: [],
            documents: documents.items,
            coverage: {
              complete: header.metadata.coverage.complete,
              findings: issues.items
                .filter((i) => i.scope === 'coverage')
                .map((i) => ({
                  code: i.code as import('../shared/audit.js').CoverageFinding['code'],
                  message: i.message,
                })),
            },
          },
        };
      }
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
              {job.progress.phase.replaceAll('-', ' ')} · {job.progress.documentsVisited ?? 0}{' '}
              documents visited · {job.progress.inspected}
              {job.progress.total === null ? '' : ' / ' + job.progress.total} images inspected
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
                  : job.progress.phase === 'inspecting-images'
                    ? 'Inspecting image metadata. Results are published when the attempt finishes.'
                    : 'Discovering documents and rendering JavaScript when enabled. Image inspection follows discovery.'}
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
            <Results
              id={id}
              result={data.results.result}
              {...(data.results.summary
                ? {
                    server: {
                      token,
                      summary: data.results.summary,
                      attempt: data.results.attempt!,
                      coveragePreviewIncomplete: data.results.coveragePreviewIncomplete ?? false,
                    },
                  }
                : {})}
            />
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
