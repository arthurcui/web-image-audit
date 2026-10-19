export interface AuditOptions {
  /** Exact URL.host entries, including non-default ports. Empty means deny all. */
  approvedHosts: readonly string[];
  concurrency?: number;
  requestTimeoutMs?: number;
  maxPageBytes?: number;
  maxImageBytes?: number;
  oversizedBytes?: number;
  maxImages?: number;
  maxOccurrences?: number;
  maxCandidates?: number;
  maxRedirects?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
}

export const defaults = {
  concurrency: 4,
  requestTimeoutMs: 10_000,
  maxPageBytes: 2_000_000,
  maxImageBytes: 10_000_000,
  oversizedBytes: 500_000,
  maxImages: 100,
  maxOccurrences: 500,
  maxCandidates: 2000,
  maxRedirects: 5,
  maxRetries: 2,
  retryBaseMs: 250,
  maxRetryDelayMs: 5000,
} as const;

export type Limits = { [K in keyof typeof defaults]: number };
export type FailureCode = 'policy' | 'invalid-url' | 'http' | 'content-type'
  | 'encoding' | 'timeout' | 'network' | 'byte-limit' | 'redirect-limit'
  | 'redirect-loop' | 'invalid-redirect' | 'retry-after';

export interface FetchResult {
  url: string;
  state: 'ok' | 'failed' | 'skipped' | 'deferred';
  code?: FailureCode;
  message?: string;
  status?: number;
  contentType?: string;
  /** Actual bytes consumed, a lower bound when bytesComplete is false. */
  bytes: number;
  bytesComplete: boolean;
  attempts: number;
  retryAfterMs?: number;
}

export interface Candidate {
  rawUrl: string;
  attribute: string;
  element: 'img' | 'source';
  descriptor?: string;
  media?: string;
  type?: string;
  /** Responsive and lazy sources are possibilities, not rendered selections. */
  role: 'fallback' | 'responsive' | 'lazy';
  url?: string;
  resourceId?: string;
  skipped?: string;
}
export interface Occurrence {
  id: string;
  alt: { state: 'missing' } | { state: 'empty' | 'text'; value: string };
  candidates: Candidate[];
}
export interface Resource extends FetchResult {
  id: string;
  requestedUrl: string;
  oversized: boolean;
}
export interface AuditResult {
  page: FetchResult;
  baseUrl?: string;
  occurrences: Occurrence[];
  resources: Resource[];
  issues: Array<{ code: string; occurrenceId?: string; resourceId?: string; message: string }>;
  coverage: { complete: boolean; reasons: string[] };
}
