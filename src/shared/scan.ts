export interface ScanOptions {
  mode: 'static' | 'rendered' | 'crawl';
  includeIframes: boolean;
  maxPages: number;
  maxDepth: number;
}
export const defaultScan: ScanOptions = { mode: 'static', includeIframes: false, maxPages: 10, maxDepth: 2 };
export function parseScan(value: unknown): ScanOptions {
  if (value === undefined) return { ...defaultScan };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid scan options');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !Object.hasOwn(defaultScan, k))) throw new Error('Unknown scan option');
  const s = { ...defaultScan, ...v } as ScanOptions;
  if (!['static', 'rendered', 'crawl'].includes(s.mode) || typeof s.includeIframes !== 'boolean'
    || !Number.isInteger(s.maxPages) || s.maxPages < 1 || s.maxPages > 20
    || !Number.isInteger(s.maxDepth) || s.maxDepth < 0 || s.maxDepth > 3) throw new Error('Invalid scan limits');
  return s;
}
