import type { AuditJob as PublicAuditJob } from '../shared/jobs.js';
import type { AuditJob } from './jobs.js';
/** Explicit allowlist: adding a persistence field never expands the public response. */
export function toPublicJob(job: AuditJob): PublicAuditJob {
  return {
    id: job.id,
    url: job.url,
    state: job.state,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: { ...job.progress },
    lastError: job.lastError ? { ...job.lastError } : null,
    ...(job.scan ? { scan: { ...job.scan } } : {}),
  };
}
