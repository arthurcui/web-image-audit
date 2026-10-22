import { normalizeResultTables } from './normalize-results.js';
const resultTables = {
  resources: 'audit_resources',
  occurrences: 'audit_occurrences',
  candidates: 'audit_candidates',
  issues: 'audit_issues',
  documents: 'audit_documents',
  coverage: 'audit_coverage',
  inventory: 'audit_inventory',
};
import type Database from 'better-sqlite3';

const resultSchema = Object.values(resultTables)
  .map(
    (table) =>
      `CREATE TABLE ${table} (job_id TEXT NOT NULL, attempt INTEGER NOT NULL, ordinal INTEGER NOT NULL, data_json TEXT NOT NULL, failed INTEGER NOT NULL, oversized INTEGER NOT NULL, missing INTEGER NOT NULL, PRIMARY KEY(job_id,attempt,ordinal), FOREIGN KEY(job_id,attempt) REFERENCES audit_results(job_id,attempt) ON DELETE CASCADE) STRICT;`,
  )
  .join('\n');
export const migrations = [
  {
    version: 1,
    sql: `
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      max_attempts INTEGER NOT NULL CHECK(max_attempts > 0),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
      lease_token TEXT, lease_until INTEGER,
      progress_json TEXT NOT NULL, last_error_json TEXT, result_json TEXT,
      CHECK ((state = 'running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
        OR (state != 'running' AND lease_token IS NULL AND lease_until IS NULL))
    ) STRICT;
    CREATE INDEX jobs_claim ON jobs(available_at, created_at) WHERE state = 'queued';
    CREATE INDEX jobs_expired ON jobs(lease_until) WHERE state = 'running';
    CREATE INDEX jobs_recent ON jobs(created_at DESC, id DESC);
    CREATE TABLE job_attempts (
      job_id TEXT NOT NULL REFERENCES jobs(id),
      attempt INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      outcome TEXT, failure_json TEXT,
      PRIMARY KEY(job_id, attempt)
    ) STRICT;
  `,
  },
  {
    version: 2,
    sql: `
    ALTER TABLE jobs ADD COLUMN owner_id TEXT NOT NULL DEFAULT '__legacy__';
    UPDATE jobs SET idempotency_key = json_array('__legacy__', idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE INDEX jobs_owner_recent ON jobs(owner_id, created_at DESC, id DESC);
    CREATE TABLE bearer_tokens (
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
      user_id TEXT NOT NULL CHECK(user_id != '__legacy__'),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX bearer_tokens_user ON bearer_tokens(user_id);
  `,
  },
  {
    version: 3,
    sql: `ALTER TABLE jobs ADD COLUMN scan_json TEXT NOT NULL DEFAULT '{"mode":"static","includeIframes":false,"maxPages":10,"maxDepth":2}';`,
  },
  {
    version: 4,
    sql: `
  CREATE TABLE worker_heartbeats (worker_id TEXT PRIMARY KEY, heartbeat_at INTEGER NOT NULL) STRICT;
  CREATE INDEX worker_heartbeats_time ON worker_heartbeats(heartbeat_at);
`,
  },
  {
    version: 5,
    sql:
      `CREATE TABLE audit_results(job_id TEXT NOT NULL REFERENCES jobs(id),attempt INTEGER NOT NULL,header_json TEXT NOT NULL,PRIMARY KEY(job_id,attempt)) STRICT;` +
      resultSchema +
      ['failed', 'oversized', 'missing']
        .map(
          (filter) =>
            `CREATE INDEX inventory_${filter} ON audit_inventory(job_id,attempt,ordinal) WHERE ${filter}=1;`,
        )
        .join('\n'),
  },
  { version: 6, sql: '' },
];

export function migrate(db: Database.Database) {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY) STRICT');
    const current = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    if ((current.version ?? 0) > migrations.length)
      throw new Error('Database schema is newer than this application');
    for (const migration of migrations) {
      if (migration.version > (current.version ?? 0)) {
        db.exec(migration.sql);
        if (migration.version === 6) normalizeResultTables(db);
        db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(migration.version);
      }
    }
  }).immediate();
}
