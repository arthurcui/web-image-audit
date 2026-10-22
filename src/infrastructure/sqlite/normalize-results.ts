import type Database from 'better-sqlite3';
import type { AuditResult } from '../../shared/audit.js';
import { normalizedSchema, prepareResult, publishResult } from './results.js';
/** One-time development-data upgrade, not a compatibility path in application reads. */
export function normalizeResultTables(db: Database.Database) {
  db.exec(
    'CREATE TEMP TABLE result_upgrade(id TEXT PRIMARY KEY,attempt INTEGER NOT NULL,data_json TEXT NOT NULL)',
  );
  let after = '';
  for (;;) {
    const row = db
      .prepare('SELECT id,attempts,result_json FROM jobs WHERE id>? ORDER BY id LIMIT 1')
      .get(after) as { id: string; attempts: number; result_json: string | null } | undefined;
    if (!row) break;
    after = row.id;
    let result: AuditResult | undefined;
    if (row.result_json) {
      result = JSON.parse(row.result_json) as AuditResult;
      const coverage = result.coverage as AuditResult['coverage'] & { reasons?: string[] };
      coverage.findings ??= (coverage.reasons ?? []).map((message) => ({
        code: 'legacy-notice',
        message,
      }));
    } else {
      const stored = db
        .prepare('SELECT header_json FROM audit_results WHERE job_id=? AND attempt=?')
        .get(row.id, row.attempts) as { header_json: string } | undefined;
      if (stored) {
        const h = JSON.parse(stored.header_json);
        const read = (table: string) =>
          (
            db
              .prepare(
                `SELECT data_json FROM ${table} WHERE job_id=? AND attempt=? ORDER BY ordinal`,
              )
              .all(row.id, row.attempts) as Array<{ data_json: string }>
          ).map((v) => JSON.parse(v.data_json));
        result = {
          ...h.metadata,
          resources: read('audit_resources'),
          occurrences: read('audit_occurrences'),
          issues: read('audit_issues'),
          documents: read('audit_documents'),
          coverage: { complete: h.metadata.coverage.complete, findings: read('audit_coverage') },
        };
      }
    }
    if (result)
      db.prepare('INSERT INTO result_upgrade VALUES (?,?,?)').run(
        row.id,
        row.attempts,
        JSON.stringify(result),
      );
  }
  for (const table of [
    'audit_inventory',
    'audit_candidates',
    'audit_occurrences',
    'audit_resources',
    'audit_issues',
    'audit_documents',
    'audit_coverage',
    'audit_results',
  ])
    db.exec(`DROP TABLE ${table}`);
  db.exec(
    'ALTER TABLE jobs RENAME TO audits; ALTER TABLE job_attempts RENAME TO audit_attempts; ALTER TABLE audits DROP COLUMN result_json;',
  );
  db.exec(normalizedSchema);
  after = '';
  for (;;) {
    const row = db
      .prepare('SELECT * FROM result_upgrade WHERE id>? ORDER BY id LIMIT 1')
      .get(after) as { id: string; attempt: number; data_json: string } | undefined;
    if (!row) break;
    after = row.id;
    publishResult(
      db,
      row.id,
      row.attempt,
      prepareResult(JSON.parse(row.data_json) as AuditResult, row.attempt),
    );
  }
  db.exec('DROP TABLE result_upgrade');
}
