import type { ScanOptions } from './scan.js';

export type FailureCode = 'policy' | 'invalid-url' | 'http' | 'content-type'
  | 'encoding' | 'timeout' | 'network' | 'byte-limit' | 'redirect-limit'
  | 'redirect-loop' | 'invalid-redirect' | 'retry-after' | 'render' | 'browser-missing' | 'browser-launch' | 'render-timeout' | 'render-navigation' | 'dom-limit';

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
  documentUrl?: string;
  documentId?: string;
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
  scan?: ScanOptions;
  documents?: Array<{ id: string; url: string; kind: 'page' | 'iframe'; depth: number; parentUrl?: string; state: string }>;
  baseUrl?: string;
  occurrences: Occurrence[];
  resources: Resource[];
  issues: Array<{ code: string; occurrenceId?: string; resourceId?: string; message: string }>;
  coverage: { complete: boolean; reasons: string[] };
}
