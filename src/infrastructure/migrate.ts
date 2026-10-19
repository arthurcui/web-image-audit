import { readConfig } from '../config.js';
import { SqliteJobStore } from './job-store.js';

const store = new SqliteJobStore(readConfig().databasePath);
store.close();
console.info('Database migrations applied.');
