import * as z from 'zod/v4';
import type { AuditResult, Candidate, Occurrence, Resource } from './audit.js';
import type { summarizeAudit } from './summary.js';
export const resultSectionSchema = z.enum([
  'summary',
  'resources',
  'occurrences',
  'candidates',
  'issues',
  'documents',
  'coverage',
  'inventory',
]);
export const inventoryFilterSchema = z.enum(['all', 'failed', 'oversized', 'missing']);
export const resultCursorSchema = z.strictObject({
  jobId: z.string(),
  attempt: z.number().int().nonnegative(),
  section: resultSectionSchema,
  filter: inventoryFilterSchema,
  after: z.number().int().min(-1),
});
export const resultQuerySchema = z.strictObject({
  section: resultSectionSchema.default('issues'),
  filter: inventoryFilterSchema.default('all'),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: resultCursorSchema.optional(),
});
export type ResultQuery = z.infer<typeof resultQuerySchema>;
export type ResultCursor = z.infer<typeof resultCursorSchema>;
export interface InventoryRow {
  key: string;
  occurrence: Occurrence;
  candidate: Candidate | null;
  resource: Resource | undefined;
  issues: string[];
}
export interface ResultHeader {
  attempt: number;
  summary: ReturnType<typeof summarizeAudit>;
  metadata: Pick<AuditResult, 'page' | 'scan' | 'baseUrl'> & { coverage: { complete: boolean } };
  counts: Record<ResultQuery['section'], number>;
}
export interface StoredPage {
  state: 'queued' | 'running' | 'completed' | 'failed';
  header: ResultHeader | null;
  items: Array<{ ordinal: number; value: unknown }>;
  total: number;
  hasMore: boolean;
}
export interface InventoryPage {
  attempt: number;
  items: InventoryRow[];
  total: number;
  page: { nextCursor: string | null; hasMore: boolean };
}
