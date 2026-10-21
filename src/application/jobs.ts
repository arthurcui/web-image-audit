import type { ScanOptions } from '../shared/scan.js';
import type { AuditResult } from '../shared/audit.js';
import type { Job, Progress, Failure, Attempt } from '../shared/jobs.js';

export interface JobCursor { createdAt: number; id: string }
export interface Claim { job: Job; token: string }
export class JobError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}
/** Owner-scoped persistence boundary for AuditService; every operation requires identity. */
export interface AuditRepository {
  create(url: string, key: string | undefined, ownerId: string, scan?: ScanOptions): { job: Job; replayed: boolean };
  get(id: string, ownerId: string): Job | undefined;
  list(limit: number, ownerId: string, before?: JobCursor): Job[];
  results(id: string, ownerId: string): { job: Job; result: AuditResult | null; attempts: Attempt[] } | undefined;
}

/** Privileged cross-owner queue access. Inject only into trusted worker code. */
export interface WorkerQueue {
  claim(leaseMs: number): Claim | undefined;
  heartbeat(claim: Claim, leaseMs: number): boolean;
  progress(claim: Claim, progress: Progress): boolean;
  complete(claim: Claim, result: AuditResult): boolean;
  fail(claim: Claim, failure: Omit<Failure, 'at'>, retryDelayMs: number, result?: AuditResult): boolean;
}
