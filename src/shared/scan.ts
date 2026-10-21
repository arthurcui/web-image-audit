import * as z from 'zod/v4';
export const scanSchema = z.strictObject({
  mode: z.enum(['static', 'rendered', 'crawl']).default('static'),
  includeIframes: z.boolean().default(false),
  maxPages: z.number().int().min(1).max(20).default(10),
  maxDepth: z.number().int().min(0).max(3).default(2),
});
export type ScanOptions = z.infer<typeof scanSchema>;
export const defaultScan: ScanOptions = scanSchema.parse({});
export function parseScan(value: unknown): ScanOptions {
  return scanSchema.parse(value === undefined ? {} : value);
}
