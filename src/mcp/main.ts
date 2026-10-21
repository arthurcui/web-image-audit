import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/sqlite/job-store.js';
import { DemoAuth } from '../application/auth.js';
import { AuditService } from '../application/audit-service.js';
import { createMcpServer } from './server.js';

let store: SqliteJobStore | undefined;
let closed = false;
function closeStore() {
  if (!closed) {
    closed = true;
    store?.close();
  }
}
try {
  const token = process.env['AUDIT_DEMO_TOKEN'];
  if (!token) throw new Error('Missing token');
  const config = readConfig();
  store = new SqliteJobStore(config.databasePath);
  const auth = new DemoAuth(store);
  const authorization = 'Bearer ' + token;
  auth.authenticate(authorization);
  const service = new AuditService(store, auth, config.approvedHosts);
  const handle = serveStdio(() => {
    const server = createMcpServer(service, authorization);
    server.server.onclose = closeStore;
    return server;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void handle.close().finally(closeStore);
    });
  process.once('exit', closeStore);
} catch {
  closeStore();
  process.stderr.write(
    'MCP startup failed. Check AUDIT_DEMO_TOKEN, database path and approved-host configuration.\n',
  );
  process.exitCode = 1;
}
