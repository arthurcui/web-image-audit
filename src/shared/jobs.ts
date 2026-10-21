import type { ScanOptions } from './scan.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed';
export interface Progress { phase: 'queued' | 'fetching-page' | 'inspecting-images' | 'completed' | 'failed'; inspected: number; total: number | null }
export interface Failure { code: string; message: string; at: number; retryable: boolean }
export interface Job {
  scan?: ScanOptions;
  id: string; ownerId: string; url: string; state: JobState; attempts: number; maxAttempts: number;
  createdAt: number; updatedAt: number; availableAt: number; leaseUntil: number | null;
  progress: Progress; lastError: Failure | null;
}
export interface Attempt {
  attempt: number; startedAt: number; endedAt: number | null; outcome: string | null; failure: Failure | null;
}
