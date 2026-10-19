import type { AuditResult } from './audit/types.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed';
export interface Progress { phase: 'queued' | 'fetching-page' | 'inspecting-images' | 'completed' | 'failed'; inspected: number; total: number | null }
export interface Failure { code: string; message: string; at: number; retryable: boolean }
export interface Job {
  id: string; ownerId: string; url: string; state: JobState; attempts: number; maxAttempts: number;
  createdAt: number; updatedAt: number; availableAt: number; leaseUntil: number | null;
  progress: Progress; lastError: Failure | null;
}
export interface Claim { job: Job; token: string }
export interface Attempt {
  attempt: number; startedAt: number; endedAt: number | null; outcome: string | null; failure: Failure | null;
}
export class JobError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}
export interface JobStore {
  create(url: string, key?: string, ownerId?: string): { job: Job; replayed: boolean };
  get(id: string, ownerId?: string): Job | undefined;
  list(limit: number, ownerId?: string): Job[];
  results(id: string, ownerId?: string): { job: Job; result: AuditResult | null; attempts: Attempt[] } | undefined;
  claim(leaseMs: number): Claim | undefined;
  heartbeat(claim: Claim, leaseMs: number): boolean;
  progress(claim: Claim, progress: Progress): boolean;
  complete(claim: Claim, result: AuditResult): boolean;
  fail(claim: Claim, failure: Omit<Failure, 'at'>, retryDelayMs: number, result?: AuditResult): boolean;
}
