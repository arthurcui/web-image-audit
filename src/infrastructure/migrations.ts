import type Database from 'better-sqlite3';

const migrations = [{
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
}];

export function migrate(db: Database.Database) {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY) STRICT');
    const current = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
    if ((current.version ?? 0) > migrations.length) throw new Error('Database schema is newer than this application');
    for (const migration of migrations) {
      if (migration.version > (current.version ?? 0)) {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(migration.version);
      }
    }
  }).immediate();
}
