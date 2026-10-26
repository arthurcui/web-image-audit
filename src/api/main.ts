// Start the loopback API with SQLite services and graceful shutdown.
import { buildApp } from './app.js';
import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/sqlite/job-store.js';

const config = readConfig();
const store = new SqliteJobStore(config.databasePath);
const app = buildApp({
  logger: true,
  fixtureMode: config.fixtureMode,
  store,
  approvedHosts: config.approvedHosts,
  mcpDatabasePath: config.databasePath,
});
app.addHook('onClose', async () => store.close());
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().catch(() => {
      app.log.error({ event: 'api_lifecycle_error' });
      process.exitCode = 1;
    });
  });
}
try {
  await app.listen({ host: '127.0.0.1', port: 3001 });
} catch {
  app.log.error({ event: 'api_lifecycle_error' });
  await app.close();
  process.exitCode = 1;
}
