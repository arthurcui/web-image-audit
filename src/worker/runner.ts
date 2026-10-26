// Claim leased jobs, run audits, and publish results with stale-worker protection.
import { setTimeout as sleep } from 'node:timers/promises';
import { runAudit } from '../application/audit/index.js';
import type { AuditOptions } from '../application/audit/types.js';
import type { AuditResult } from '../shared/audit.js';
import type { WorkerQueue } from '../application/jobs.js';

import type { AuditLogEvent } from './log.js';
type Audit = typeof runAudit;
interface WorkerOptions {
  auditOptions: AuditOptions;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  audit?: Audit;
  onEvent?: (event: AuditLogEvent) => void;
  onError?: (error: unknown) => void;
}

/** One job at a time per process. Multiple processes safely share a SQLite file. */
export class AuditWorker {
  private stopping = false;
  private readonly wake = new AbortController();
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private readonly audit: Audit;
  constructor(
    private readonly queue: WorkerQueue,
    private readonly options: WorkerOptions,
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? 5000;
    this.pollMs = options.pollMs ?? 500;
    this.audit = options.audit ?? runAudit;
    if (
      !Number.isInteger(this.leaseMs) ||
      this.leaseMs < 10 ||
      this.leaseMs > 3_600_000 ||
      !Number.isInteger(this.heartbeatMs) ||
      this.heartbeatMs < 1 ||
      this.heartbeatMs >= this.leaseMs / 2 ||
      !Number.isInteger(this.pollMs) ||
      this.pollMs < 1 ||
      this.pollMs > 60_000
    ) {
      throw new RangeError('Invalid worker timing configuration');
    }
  }
  /** Drain the current job with heartbeats; stop taking new work immediately. */
  stop() {
    this.stopping = true;
    this.wake.abort();
  }
  async run() {
    while (!this.stopping) {
      try {
        if (await this.runOnce()) continue;
      } catch (error) {
        this.options.onError?.(error);
      }
      if (!this.stopping)
        await sleep(this.pollMs, undefined, { signal: this.wake.signal }).catch(() => {});
    }
  }
  async runOnce(): Promise<boolean> {
    if (this.stopping) return false;
    const claim = this.queue.claim(this.leaseMs);
    if (!claim) return false;
    const emit = (event: AuditLogEvent['event'], resources?: number) =>
      this.options.onEvent?.({
        event,
        auditId: claim.job.id,
        attempt: claim.job.attempts,
        ...(resources === undefined ? {} : { resources }),
      });
    emit('audit_claimed');
    let lost = false;
    let documentsVisited = 0;
    let documentsScheduled = 0;
    const heartbeat = setInterval(() => {
      try {
        if (!this.queue.heartbeat(claim, this.leaseMs)) lost = true;
      } catch (error) {
        lost = true;
        this.options.onError?.(error);
      }
    }, this.heartbeatMs);
    try {
      const result = await this.audit(
        claim.job.url,
        { ...this.options.auditOptions, ...(claim.job.scan ? { scan: claim.job.scan } : {}) },
        {
          onDocumentProgress: (progress) => {
            documentsVisited = progress.documentsVisited;
            documentsScheduled = progress.documentsScheduled;
            if (!lost && !this.queue.progress(claim, { ...progress, inspected: 0, total: null }))
              lost = true;
          },
          onProgress: (progress) => {
            if (
              !lost &&
              !this.queue.progress(claim, {
                phase: 'inspecting-images',
                documentsVisited,
                documentsScheduled,
                ...progress,
              })
            )
              lost = true;
          },
        },
      );
      if (lost) {
        emit('audit_lease_lost');
        return true;
      }
      if (result.page.state === 'ok') {
        emit(
          this.queue.complete(claim, result) ? 'audit_completed' : 'audit_lease_lost',
          result.resources.length,
        ); // Individual image failures still complete the audit.
      } else {
        const failure = pageFailure(result);
        const retryAfter = result.page.retryAfterMs ?? 0;
        const saved = this.queue.fail(
          claim,
          failure,
          Math.max(retryAfter <= 86_400_000 ? retryAfter : 0, 1000 * 2 ** (claim.job.attempts - 1)),
          result,
        );
        emit(
          !saved
            ? 'audit_lease_lost'
            : failure.retryable && claim.job.attempts < claim.job.maxAttempts
              ? 'audit_retry'
              : 'audit_failed',
        );
      }
    } catch (error) {
      if (!lost)
        this.queue.fail(
          claim,
          {
            code: 'worker_error',
            message:
              error instanceof Error ? error.message.slice(0, 1000) : 'Unexpected worker failure',
            retryable: true,
          },
          1000 * 2 ** (claim.job.attempts - 1),
        );
      emit('worker_error');
      this.options.onError?.(error);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
function pageFailure(result: AuditResult) {
  const page = result.page;
  const transient =
    page.code === 'timeout' ||
    page.code === 'network' ||
    (page.code === 'http' && [408, 429, 500, 502, 503, 504].includes(page.status ?? 0)) ||
    (page.code === 'retry-after' && page.retryAfterMs !== undefined);
  return {
    code: page.code ?? 'page_failed',
    message: page.message ?? 'Could not inspect the page',
    retryable: transient && (page.retryAfterMs === undefined || page.retryAfterMs <= 86_400_000),
  };
}
