import type { InjectOptions } from 'fastify';
import { provisionToken } from '../../src/application/auth.js';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { SqliteJobStore } from '../../src/infrastructure/job-store.js';
import { buildApp } from '../../src/api/app.js';
import { AuditWorker } from '../../src/worker/runner.js';
import type { AuditResult } from '../../src/shared/audit.js';

async function database(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'image-audit-jobs-'));
  const path = join(directory, 'jobs.sqlite');
  const stores: SqliteJobStore[] = [];
  t.after(async () => {
    for (const store of stores) { try { store.close(); } catch { /* already closed in persistence tests */ } }
    await rm(directory, { recursive: true, force: true });
  });
  return { path, open: (now?: () => number) => {
    const store = new SqliteJobStore(path, now);
    stores.push(store);
    return store;
  } };
}
function successful(): AuditResult {
  return { page: { url: 'https://example.com/', state: 'ok', bytes: 1, bytesComplete: true, attempts: 1 },
    occurrences: [], resources: [], issues: [], coverage: { complete: true, reasons: [] } };
}
async function processPair(t: TestContext, path: string, action: string): Promise<unknown[]> {
  const children = [0, 1].map(() => fork(fileURLToPath(new URL('../helpers/job-process.ts', import.meta.url)),
    [path, action], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  t.after(() => children.forEach((child) => { if (child.exitCode === null) child.kill(); }));
  const ready = children.map((child) => new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.on('message', (message: { ready?: boolean }) => { if (message.ready) resolve(); });
    child.once('exit', (code) => { if (code !== 0) reject(new Error('Child failed: ' + code)); });
  }));
  const results = children.map((child) => new Promise<unknown>((resolve, reject) => {
    child.once('error', reject);
    child.on('message', (message: { result?: unknown }) => { if ('result' in message) resolve(message.result); });
    child.once('exit', (code) => { if (code !== 0) reject(new Error('Child failed: ' + code)); });
  }));
  await Promise.all(ready);
  children.forEach((child) => child.send('go'));
  return Promise.all(results);
}

test('separate processes cannot claim the same job concurrently', { timeout: 10_000 }, async (t) => {
  const db = await database(t);
  const store = db.open();
  store.create('https://example.com/', undefined, 'fixture-user');
  const results = await processPair(t, db.path, 'claim');
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(store.list(10, 'fixture-user')[0]!.attempts, 1);
});

test('concurrent idempotent creation returns one persisted job', { timeout: 10_000 }, async (t) => {
  const db = await database(t);
  const store = db.open();
  const results = await processPair(t, db.path, 'create') as Array<{ job: { id: string } }>;
  assert.equal(results[0]!.job.id, results[1]!.job.id);
  assert.equal(store.list(100, 'fixture-user').length, 1);
  assert.throws(() => store.create('https://example.com/different', 'shared-key', 'fixture-user'),
    (error: unknown) => (error as { statusCode: number }).statusCode === 409);
  store.close();
  assert.equal(db.open().create('https://example.com/', 'shared-key', 'fixture-user').job.id, results[0]!.job.id);
});

test('expired leases reject all stale writes before and after recovery', async (t) => {
  const db = await database(t);
  let now = 1000;
  const old = db.open(() => now);
  const fresh = db.open(() => now);
  const created = old.create('https://example.com/', undefined, 'fixture-user');
  const first = old.claim(100)!;
  now = 1100;
  assert.equal(old.heartbeat(first, 100), false);
  assert.equal(old.progress(first, { phase: 'inspecting-images', inspected: 1, total: 2 }), false);
  assert.equal(old.complete(first, successful()), false);
  assert.equal(old.fail(first, { code: 'late', message: 'late', retryable: false }, 0), false);
  const second = fresh.claim(100)!;
  assert.equal(second.job.id, created.job.id);
  assert.notEqual(first.token, second.token);
  assert.equal(second.job.attempts, 2);
  assert.equal(old.complete(first, successful()), false);
  assert.equal(old.fail(first, { code: 'late', message: 'late', retryable: false }, 0), false);
  assert.equal(old.heartbeat(first, 100), false);
  assert.equal(old.progress(first, { phase: 'failed', inspected: 99, total: 99 }), false);
  assert.equal(fresh.complete(second, successful()), true);
  assert.equal(old.complete(first, successful()), false);
  const saved = fresh.results(created.job.id, 'fixture-user')!;
  assert.equal(saved.job.state, 'completed');
  assert.equal(saved.attempts[0]!.failure!.code, 'lease_expired');
  assert.equal(saved.attempts[1]!.outcome, 'completed');
});

test('a process that exits after claiming is recovered and repeated crashes exhaust attempts', { timeout: 10_000 }, async (t) => {
  const db = await database(t);
  const store = db.open();
  store.create('https://example.com/', undefined, 'fixture-user');
  await processPair(t, db.path, 'claim');
  let now = Date.now() + 1000;
  const recovery = db.open(() => now);
  const second = recovery.claim(100)!;
  assert.equal(second.job.attempts, 2);
  now += 100;
  const third = recovery.claim(100)!;
  assert.equal(third.job.attempts, 3);
  now += 100;
  assert.equal(recovery.claim(100), undefined);
  const final = recovery.results(third.job.id, 'fixture-user')!;
  assert.equal(final.job.state, 'failed');
  assert.equal(final.attempts.length, 3);
  assert.ok(final.attempts.every((attempt) => attempt.failure?.code === 'lease_expired'));
});

test('retry scheduling and result publication never expose an obsolete attempt snapshot', async (t) => {
  const db = await database(t);
  let now = 0;
  const store = db.open(() => now);
  const id = store.create('https://example.com/', undefined, 'fixture-user').job.id;
  const first = store.claim(1000)!;
  const failedResult = successful();
  failedResult.page.state = 'failed';
  store.fail(first, { code: 'timeout', message: 'timeout', retryable: true }, 500, failedResult);
  assert.equal(store.get(id, 'fixture-user')!.state, 'queued');
  assert.equal(store.results(id, 'fixture-user')!.result, null);
  assert.equal(store.claim(1000), undefined);
  now = 500;
  const second = store.claim(1000)!;
  assert.equal(store.results(id, 'fixture-user')!.result, null);
  store.complete(second, successful());
  assert.equal(store.complete(second, failedResult), false);
  store.close();
  const restored = db.open().results(id, 'fixture-user')!;
  assert.equal(restored.job.state, 'completed');
  assert.equal(restored.result!.page.state, 'ok');
  assert.equal(restored.attempts.length, 2);
});

test('worker drains current work, maintains heartbeats, and stops claiming new jobs', async (t) => {
  const db = await database(t);
  const store = db.open();
  const contender = db.open();
  const first = store.create('https://example.com/1', undefined, 'fixture-user').job;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  const worker = new AuditWorker(store, {
    auditOptions: { approvedHosts: [] }, leaseMs: 300, heartbeatMs: 30, pollMs: 10,
    audit: async () => { started(); await gate; return successful(); },
  });
  const running = worker.run();
  await began;
  worker.stop();
  await sleep(400);
  assert.equal(contender.claim(300), undefined, 'heartbeats keep the active claim alive while draining');
  const second = store.create('https://example.com/2', undefined, 'fixture-user').job;
  release();
  await running;
  assert.equal(store.get(first.id, 'fixture-user')!.state, 'completed');
  assert.equal(store.get(second.id, 'fixture-user')!.state, 'queued');
});

test('worker records bounded failures and respects page Retry-After at the job layer', async (t) => {
  const db = await database(t);
  let now = 0;
  const store = db.open(() => now);
  const id = store.create('https://example.com/', undefined, 'fixture-user').job.id;
  const worker = new AuditWorker(store, {
    auditOptions: { approvedHosts: [] },
    audit: async () => ({ ...successful(), page: {
      ...successful().page, state: 'deferred', code: 'retry-after', retryAfterMs: 20_000,
    } }),
  });
  await worker.runOnce();
  assert.equal(store.get(id, 'fixture-user')!.availableAt, 20_000);
  assert.equal(await worker.runOnce(), false);
  now = 20_000;
  await worker.runOnce();
  now = 40_000;
  await worker.runOnce();
  assert.equal(store.get(id, 'fixture-user')!.state, 'failed');
  assert.equal(store.get(id, 'fixture-user')!.attempts, 3);
  assert.equal(store.results(id, 'fixture-user')!.result!.page.code, 'retry-after');
});

test('API validates inputs, replays idempotency keys, and returns consistent errors', async (t) => {
  const db = await database(t);
  const store = db.open();
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(() => app.close());
  const authorization = 'Bearer ' + provisionToken(store, 'fixture-user');
  const inject = (input: string | InjectOptions) => {
    const request = typeof input === 'string' ? { url: input } : input;
    return app.inject({ ...request, headers: { ...request.headers, authorization } });
  };
  const create = (url: string, key = 'test-key') => inject({
    method: 'POST', url: '/api/audits', headers: { 'idempotency-key': key }, payload: { url },
  });
  const first = await create('https://example.com/');
  assert.equal(first.statusCode, 202);
  const body = first.json<{ id: string; statusUrl: string; resultsUrl: string }>();
  assert.equal(first.headers.location, body.statusUrl);
  assert.equal((await create('https://example.com/')).json<{ id: string }>().id, body.id);
  const conflict = await create('https://example.com/other');
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json<{ error: { code: string } }>().error.code, 'idempotency_conflict');
  const status = await inject(body.statusUrl);
  assert.equal(status.json<{ state: string }>().state, 'queued');
  assert.ok(!status.body.includes('lease_token'));
  assert.equal((await inject(body.resultsUrl)).json<{ available: boolean }>().available, false);
  assert.equal((await inject('/api/audits?limit=1')).json<{ jobs: unknown[] }>().jobs.length, 1);
  for (const response of [
    await create('https://not-approved.example/'),
    await create('https://user:password@example.com/'),
    await create('https://example.com/', 'bad key'),
    await inject({ method: 'POST', url: '/api/audits', payload: {} }),
    await inject({ method: 'POST', url: '/api/audits', payload: { url: 'https://example.com/', approvedHosts: ['evil.test'] } }),
    await inject({ method: 'POST', url: '/api/audits', headers: { 'content-type': 'application/json' }, payload: '{broken' }),
    await inject('/api/audits?limit=101'),
    await inject('/api/audits/not-an-id'),
  ]) {
    assert.equal(response.statusCode, 400);
    assert.equal(typeof response.json<{ error: { code: string } }>().error.code, 'string');
  }
  assert.equal((await inject('/api/audits/' + randomUUID())).statusCode, 404);
  assert.equal((await inject('/api/audits/' + randomUUID() + '/results')).statusCode, 404);
});

test('real engine and worker publish partial-image audits as completed and page failures as failed', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<img src="/bad"><img src="/good" alt="">');
    if (req.url === '/good') return res.writeHead(200, { 'content-type': 'image/png' }).end('image bytes');
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const db = await database(t);
  const store = db.open();
  const app = buildApp({ store, approvedHosts: [new URL(origin).host] });
  t.after(() => app.close());
  const authorization = 'Bearer ' + provisionToken(store, 'fixture-user');
  const inject = (input: string | InjectOptions) => {
    const request = typeof input === 'string' ? { url: input } : input;
    return app.inject({ ...request, headers: { ...request.headers, authorization } });
  };
  const created = await inject({ method: 'POST', url: '/api/audits', payload: { url: origin + '/page' } });
  const id = created.json<{ id: string }>().id;
  const worker = new AuditWorker(store, { auditOptions: { approvedHosts: [new URL(origin).host], maxRetries: 0 } });
  await worker.runOnce();
  const result = (await inject('/api/audits/' + id + '/results')).json<{ state: string; result: AuditResult }>();
  assert.equal(result.state, 'completed');
  assert.equal(result.result.resources[0]!.state, 'failed');
  assert.equal(result.result.resources[1]!.state, 'ok');
  assert.equal(store.get(id, 'fixture-user')!.progress.inspected, 2);
  const failedId = store.create(origin + '/missing-page', undefined, 'fixture-user').job.id;
  await worker.runOnce();
  assert.equal(store.get(failedId, 'fixture-user')!.state, 'failed');
  assert.equal(store.get(failedId, 'fixture-user')!.attempts, 1);
  assert.equal(store.results(failedId, 'fixture-user')!.result!.page.status, 404);
});

test('separate worker entry points consume the persistent queue against local HTTP fixtures', { timeout: 15_000 }, async (t) => {
  let pages = 0;
  const server = createServer((_req, res) => {
    pages++;
    res.writeHead(200, { 'content-type': 'text/html' }).end('<p>No images</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const db = await database(t);
  const store = db.open();
  for (let i = 0; i < 4; i++) store.create(origin + '/' + i, undefined, 'fixture-user');
  const children = [0, 1].map(() => fork(fileURLToPath(new URL('../../src/worker/main.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, AUDIT_DB_PATH: db.path, AUDIT_APPROVED_HOSTS: new URL(origin).host },
  }));
  const exited = children.map((child) => new Promise<void>((resolve) => child.once('exit', () => resolve())));
  try {
    const deadline = Date.now() + 8000;
    while (store.list(10, 'fixture-user').some((job) => job.state !== 'completed') && Date.now() < deadline) await sleep(25);
    assert.ok(store.list(10, 'fixture-user').every((job) => job.state === 'completed' && job.attempts === 1));
    assert.equal(pages, 4);
  } finally {
    children.forEach((child) => child.kill());
    await Promise.all(exited);
  }
});
