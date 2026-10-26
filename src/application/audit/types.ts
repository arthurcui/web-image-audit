// Define engine options, limits, and progress hooks.
import type { ScanOptions } from '../../shared/scan.js';
export interface AuditOptions {
  scan?: ScanOptions;
  /** Exact URL.host entries, including non-default ports. Empty means deny all. */
  approvedHosts: readonly string[];
  concurrency?: number;
  requestTimeoutMs?: number;
  maxPageBytes?: number;
  maxImageBytes?: number;
  oversizedBytes?: number;
  maxUniqueResources?: number;
  maxOccurrences?: number;
  maxCandidates?: number;
  maxRedirects?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
}

export const defaultAuditLimits = {
  concurrency: 4,
  requestTimeoutMs: 10_000,
  maxPageBytes: 2_000_000,
  maxImageBytes: 10_000_000,
  oversizedBytes: 500_000,
  maxUniqueResources: 100,
  maxOccurrences: 500,
  maxCandidates: 2000,
  maxRedirects: 5,
  maxRetries: 2,
  retryBaseMs: 250,
  maxRetryDelayMs: 5000,
} as const;

export type Limits = { [K in keyof typeof defaultAuditLimits]: number };

export interface DocumentProgress {
  phase: 'fetching-document' | 'rendering-document' | 'discovering-documents';
  documentsVisited: number;
  documentsScheduled: number;
}
