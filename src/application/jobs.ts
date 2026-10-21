import type { ScanOptions } from '../shared/scan.js';
import type { AuditResult } from '../shared/audit.js';
import type { AuditJob as PublicAuditJob, Progress, Failure, Attempt } from '../shared/jobs.js';

export type { AuditCursor as JobCursor } from '../shared/inputs.js';
import type { AuditCursor as JobCursor } from '../shared/inputs.js';
/** Internal persistence record; never serialize to clients. */
export interface AuditJob extends PublicAuditJob {
  ownerId: string;
  availableAt: number;
  leaseUntil: number | null;
}
export interface Claim {
  job: AuditJob;
  token: string;
}
export class JobError extends Error {
  constructor(
    public readonly code:
      | 'invalid_request'
      | 'invalid_idempotency_key'
      | 'invalid_target'
      | 'unauthorized'
      | 'origin_not_allowed'
      | 'job_not_found'
      | 'idempotency_conflict'
      | 'demo_busy'
      | 'mcp_unavailable',
    message: string,
  ) {
    super(message);
  }
}
/** Owner-scoped persistence boundary for AuditService; every operation requires identity. */
export interface AuditRepository {
  create(
    url: string,
    key: string | undefined,
    ownerId: string,
    scan?: ScanOptions,
  ): { job: AuditJob; replayed: boolean };
  get(id: string, ownerId: string): AuditJob | undefined;
  list(limit: number, ownerId: string, before?: JobCursor): AuditJob[];
  results(
    id: string,
    ownerId: string,
  ): { job: AuditJob; result: AuditResult | null; attempts: Attempt[] } | undefined;
}

/** Privileged cross-owner queue access. Inject only into trusted worker code. */
export interface WorkerQueue {
  claim(leaseMs: number): Claim | undefined;
  heartbeat(claim: Claim, leaseMs: number): boolean;
  progress(claim: Claim, progress: Progress): boolean;
  complete(claim: Claim, result: AuditResult): boolean;
  fail(
    claim: Claim,
    failure: Omit<Failure, 'at'>,
    retryDelayMs: number,
    result?: AuditResult,
  ): boolean;
}
