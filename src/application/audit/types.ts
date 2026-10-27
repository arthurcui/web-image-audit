// Define engine options, limits, and progress hooks.
import type { ScanOptions } from '../../shared/scan.js';
export interface AuditOptions {
  scan?: ScanOptions;
  /** Exact URL.host entries, including non-default ports. Empty means deny all. */
  approvedHosts: readonly string[];
  concurrency?: number;
  maxCandidates?: number;
  maxImageBytes?: number;
  maxOccurrences?: number;
  maxPageBytes?: number;
  maxRedirects?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  maxUniqueResources?: number;
  oversizedBytes?: number;
  requestTimeoutMs?: number;
  retryBaseMs?: number;
}

export const defaultAuditLimits = {
  concurrency: 4,
  maxCandidates: 2000,
  maxImageBytes: 10_000_000,
  maxOccurrences: 500,
  maxPageBytes: 2_000_000,
  maxRedirects: 5,
  maxRetries: 2,
  maxRetryDelayMs: 5000,
  maxUniqueResources: 100,
  oversizedBytes: 500_000,
  requestTimeoutMs: 10_000,
  retryBaseMs: 250,
} as const;

export type Limits = { [K in keyof typeof defaultAuditLimits]: number };

export interface DocumentProgress {
  phase: 'fetching-document' | 'rendering-document' | 'discovering-documents';
  documentsVisited: number;
  documentsScheduled: number;
}
