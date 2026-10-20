import { writeAuditLog } from './log.js';
import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/job-store.js';
import { AuditWorker } from './runner.js';

const config = readConfig();
const store = new SqliteJobStore(config.databasePath);
const worker = new AuditWorker(store, {
  auditOptions: { approvedHosts: config.approvedHosts },
  onEvent: writeAuditLog,
  onError: () => writeAuditLog({ event: 'worker_error' }),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  writeAuditLog({ event: 'worker_stopping' });
  worker.stop();
});
writeAuditLog({ event: 'worker_started' });
try { await worker.run(); }
finally { store.close(); }
