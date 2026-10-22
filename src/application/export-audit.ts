import type { AuditService } from './audit-service.js';
import type { ResultCursor, InventoryRow } from '../shared/result-query.js';
import { toCsv } from '../shared/inventory.js';
import type { AuditResult } from '../shared/audit.js';
/** Read a batch, release its transaction, then yield to the HTTP stream with backpressure. */
export function exportAudit(
  service: AuditService,
  authorization: unknown,
  id: string,
  format: 'json' | 'csv',
) {
  const start = service.storedPage(authorization, id, { section: 'summary' });
  const header = start.header;
  async function* chunks() {
    if (!header) {
      yield format === 'json' ? 'null' : 'No published result\r\n';
      return;
    }
    const empty: AuditResult = {
      ...header.metadata,
      resources: [],
      occurrences: [],
      issues: [],
      coverage: { complete: header.metadata.coverage.complete, findings: [] },
    };
    if (format === 'csv') yield toCsv(empty);
    else {
      const { coverage: _coverage, ...metadata } = header.metadata;
      yield JSON.stringify(metadata).slice(0, -1);
    }
    const sections =
      format === 'csv'
        ? (['inventory'] as const)
        : (['resources', 'occurrences', 'issues', 'documents', 'coverage'] as const);
    for (const section of sections) {
      let cursor: ResultCursor | undefined = {
        jobId: id,
        attempt: header.attempt,
        section,
        filter: 'all',
        after: -1,
      };
      let first = true;
      if (format === 'json')
        yield section === 'coverage'
          ? ',"coverage":{"complete":' + header.metadata.coverage.complete + ',"findings":['
          : ',"' + section + '":[';
      while (cursor) {
        const page = service.storedPage(authorization, id, { section, limit: 100, cursor });
        for (const item of page.items) {
          if (format === 'json') {
            const value = item.value as { scope?: string };
            if (section === 'issues' && value.scope === 'coverage') continue;
            const { scope: _scope, ...data } = value;
            yield (first ? '' : ',') + JSON.stringify(data);
            first = false;
          } else {
            const row = item.value as InventoryRow;
            const csv = toCsv({
              ...empty,
              occurrences: [
                { ...row.occurrence, candidates: row.candidate ? [row.candidate] : [] },
              ],
              resources: row.resource ? [row.resource] : [],
              issues: row.issues.map((message) => ({
                code: 'export',
                message,
                occurrenceId: row.occurrence.id,
              })),
            });
            yield csv.slice(csv.indexOf('\r\n') + 2);
          }
        }
        cursor = page.hasMore ? { ...cursor, after: page.items.at(-1)!.ordinal } : undefined;
        // Do not monopolize the event loop or keep a transaction open while streaming.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (format === 'json') yield section === 'coverage' ? ']}' : ']';
    }
    if (format === 'json') yield '}';
  }
  return chunks();
}
