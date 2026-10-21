import type { AuditResult } from './audit.js';
import type { ScanOptions } from './scan.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed';
export interface Progress {
  phase: 'queued' | 'fetching-page' | 'inspecting-images' | 'completed' | 'failed';
  inspected: number;
  total: number | null;
}
export interface Failure {
  code: string;
  message: string;
  at: number;
  retryable: boolean;
}
/** Public job DTO. Ownership, queue scheduling and lease fields remain internal. */
export interface AuditJob {
  scan?: ScanOptions;
  id: string;
  url: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  progress: Progress;
  lastError: Failure | null;
}
export interface Attempt {
  attempt: number;
  startedAt: number;
  endedAt: number | null;
  outcome: string | null;
  failure: Failure | null;
}

export interface ResultsResponse {
  id: string;
  state: JobState;
  available: boolean;
  result: AuditResult | null;
  attempts: Attempt[];
}
