import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureServer } from '../../src/demo/fixture.js';
import { readConfig } from '../../src/config.js';
import { runAudit } from '../../src/application/audit/index.js';
import { writeAuditLog } from '../../src/worker/log.js';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { AuditWorker } from '../../src/worker/runner.js';
import { buildApp } from '../../src/api/app.js';
import { provisionToken } from '../../src/application/auth.js';
import { Writable } from 'node:stream';

test('demo fixture has deterministic findings and uses the normal strict fetch policy', async (t) => {
  const server = createFixtureServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const host = '127.0.0.1:' + (server.address() as { port: number }).port;
  const result = await runAudit('http://' + host, { approvedHosts: [host] });
  assert.equal(result.occurrences.length, 6);
  assert.equal(result.resources.length, 5);
  assert.equal(result.occurrences.flatMap((o) => o.candidates).length, 7);
  assert.equal(result.occurrences.filter((o) => o.alt.state === 'missing').length, 1);
  assert.equal(result.occurrences.filter((o) => o.alt.state === 'empty').length, 1);
  assert.equal(result.resources.filter((r) => r.oversized).length, 1);
  assert.equal(result.resources.filter((r) => r.status === 404).length, 1);
  const denied = await runAudit('http://' + host, { approvedHosts: [] });
  assert.equal(denied.page.code, 'policy');
  const normal = readConfig({});
  assert.deepEqual(normal.approvedHosts, []);
  assert.equal(normal.fixtureMode, false);
  const demo = readConfig({
    AUDIT_FIXTURE_MODE: '1',
    AUDIT_APPROVED_HOSTS: 'evil.example',
    AUDIT_DB_PATH: 'production.db',
  });
  assert.deepEqual(demo.approvedHosts, ['127.0.0.1:3105']);
  assert.notEqual(demo.databasePath, normal.databasePath);
  assert.match(demo.databasePath, /demo/);
});

test('API and worker logs correlate audit IDs without tokens, query strings, or exception contents', async (t) => {
  const store = new SqliteJobStore(':memory:');
  t.after(() => store.close());
  const token = provisionToken(store, 'fixture');
  let logs = '';
  const app = buildApp({
    store,
    logger: true,
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
    approvedHosts: ['example.com'],
    fixtureMode: true,
  });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/health')).json().mode, 'fixture');
  const response = await app.inject({
    method: 'POST',
    url: '/api/audits',
    headers: { authorization: 'Bearer ' + token },
    payload: { url: 'https://example.com/?secret=PRIVATE_QUERY' },
  });
  const { id } = response.json() as { id: string };
  const worker = new AuditWorker(store, {
    auditOptions: { approvedHosts: ['example.com'] },
    onEvent: (e) =>
      writeAuditLog(e, (line) => {
        logs += line;
      }),
    audit: async () => {
      throw new Error(token + ' PRIVATE_QUERY');
    },
  });
  await worker.runOnce();
  assert.ok(logs.includes(id));
  assert.ok(logs.includes('audit_claimed'));
  assert.ok(logs.includes('worker_error'));
  assert.ok(!logs.includes(token));
  assert.ok(!logs.includes('PRIVATE_QUERY'));
  assert.ok(!logs.includes('https://'));
  for (const line of logs.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
});

test('fixture bootstrap is local-only, fixed-identity, and retains ownership checks', async (t) => {
  const store = new SqliteJobStore(':memory:');
  let logs = '';
  const app = buildApp({
    store,
    fixtureMode: true,
    approvedHosts: ['example.com'],
    logger: true,
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
  const normal = buildApp();
  t.after(async () => {
    await app.close();
    await normal.close();
    store.close();
  });
  const headers = { origin: 'http://127.0.0.1:5173', host: '127.0.0.1:3001' };
  const request = {
    method: 'POST' as const,
    url: '/api/demo/session',
    headers,
    remoteAddress: '127.0.0.1',
  };
  assert.equal((await normal.inject(request)).statusCode, 404);
  assert.equal((await app.inject({ ...request, remoteAddress: '192.0.2.1' })).statusCode, 403);
  assert.equal(
    (await app.inject({ ...request, headers: { ...headers, origin: 'https://evil.example' } }))
      .statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ ...request, headers: { ...headers, host: 'evil.example' } })).statusCode,
    403,
  );
  assert.equal((await app.inject({ ...request, headers: { host: headers.host } })).statusCode, 403);
  assert.equal((await app.inject({ ...request, payload: { userId: 'victim' } })).statusCode, 400);
  const response = await app.inject(request);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const token = response.json<{ token: string }>().token;
  assert.match(token, /^wia_[A-Za-z0-9_-]{43}$/);
  assert.equal((await app.inject(request)).json().token, token);
  const authorization = 'Bearer ' + token;
  const created = await app.inject({
    method: 'POST',
    url: '/api/audits',
    headers: { authorization },
    payload: { url: 'https://example.com/' },
  });
  assert.equal(created.statusCode, 202);
  const id = created.json().id;
  const other = 'Bearer ' + provisionToken(store, 'other-user');
  assert.equal(
    (await app.inject({ url: '/api/audits/' + id, headers: { authorization: other } })).statusCode,
    404,
  );
  assert.equal((await app.inject('/api/audits')).statusCode, 401);
  assert.equal(
    (await normal.inject({ url: '/api/audits', headers: { authorization } })).statusCode,
    401,
  );
  assert.ok(!logs.includes(token));
});
