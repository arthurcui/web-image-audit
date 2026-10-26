// Open SQLite with persistence settings and apply schema migrations.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from './migrations.js';

/** One setup path for API, worker, MCP and CLI connections. Caller owns close(). */
export function openSqlite(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path, { timeout: 1000 });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
