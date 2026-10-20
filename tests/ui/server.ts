import { createServer as createHttpServer } from 'node:http';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildApp } from '../../src/api/app.js';
import { SqliteJobStore } from '../../src/infrastructure/job-store.js';
import { tokenHash } from '../../src/application/auth.js';
import { fixtureToken } from './fixture.js';

const directory = await mkdtemp(join(tmpdir(), 'wia-browser-'));
const path = join(directory, 'audits.sqlite');
const store = new SqliteJobStore(path);
store.saveToken(tokenHash(fixtureToken), 'browser-fixture');
const fixture = createHttpServer((req, res) => {
  if (req.url === '/page') {
    res.setHeader('content-type', 'text/html');
    res.end('<img src="/ok.png" alt=""><img src="/ok.png"><picture><source srcset="/big.png 2x"><img src="/missing.png" alt="=SUM(1,2)"></picture><img data-src="https://unapproved.invalid/lazy.png" alt="lazy">');
  } else if (req.url === '/ok.png' || req.url === '/big.png') {
    res.setHeader('content-type', 'image/png');
    setTimeout(() => res.end(Buffer.alloc(req.url === '/big.png' ? 600_000 : 64)), 1800);
  } else { res.statusCode = 404; res.end('Not found'); }
});
await new Promise<void>((resolve) => fixture.listen(3102, '127.0.0.1', resolve));
const api = buildApp({ store, approvedHosts: ['127.0.0.1:3102'], mcpDatabasePath: path });
await api.listen({ host: '127.0.0.1', port: 3101 });
const child = fork(fileURLToPath(new URL('../../src/worker/main.ts', import.meta.url)), [], {
  execArgv: ['--import', 'tsx'], stdio: 'ignore',
  env: { ...process.env, AUDIT_DB_PATH: path, AUDIT_APPROVED_HOSTS: '127.0.0.1:3102' },
});
const web = await createServer({ server: {
  host: '127.0.0.1', port: 4173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3101' },
} });
await web.listen();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill();
  await web.close(); await api.close();
  fixture.closeAllConnections(); fixture.close(); store.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().finally(() => process.exit()); });
