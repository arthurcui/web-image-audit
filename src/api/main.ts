import { buildApp } from './app.js';
import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/job-store.js';

const config = readConfig();
const store = new SqliteJobStore(config.databasePath);
const app = buildApp({ logger: true, store, approvedHosts: config.approvedHosts, mcpDatabasePath: config.databasePath });
app.addHook('onClose', async () => store.close());
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().catch((error: unknown) => { app.log.error(error); process.exitCode = 1; });
  });
}
try {
  await app.listen({ host: '127.0.0.1', port: 3001 });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
