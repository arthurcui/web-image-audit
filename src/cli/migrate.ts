// Apply SQLite migrations to the configured database.
import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/sqlite/job-store.js';

const store = new SqliteJobStore(readConfig().databasePath);
store.close();
console.info('Database migrations applied.');
