import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/job-store.js';
import { AuditWorker } from './runner.js';

const config = readConfig();
const store = new SqliteJobStore(config.databasePath);
const worker = new AuditWorker(store, {
  auditOptions: { approvedHosts: config.approvedHosts },
  onError: (error) => console.error('Worker error:', error),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  console.info('Worker draining current audit; no new jobs will be claimed.');
  worker.stop();
});
console.info('Audit worker started.');
try { await worker.run(); }
finally { store.close(); }
