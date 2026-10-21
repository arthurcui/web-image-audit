import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import Database from 'better-sqlite3';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { DemoAuth, provisionToken, tokenHash } from '../../src/application/auth.js';
import { AuditService } from '../../src/application/audit-service.js';
import { buildApp } from '../../src/api/app.js';
import { JobError } from '../../src/application/jobs.js';
import type { AuditResult } from '../../src/shared/audit.js';

function setup(t: TestContext) {
  const store = new SqliteJobStore(':memory:');
  t.after(() => store.close());
  const auth = new DemoAuth(store);
  const a = 'Bearer ' + provisionToken(store, 'user-a');
  const b = 'Bearer ' + provisionToken(store, 'user-b');
  const service = new AuditService(store, auth, ['example.com']);
  return { store, auth, a, b, service };
}
const errorCode = (status: number) => (error: unknown) =>
  error instanceof JobError &&
  error.code ===
    (
      {
        401: 'unauthorized',
        404: 'job_not_found',
        400: 'invalid_request',
        409: 'idempotency_conflict',
      } as Record<number, string>
    )[status];

test('shared application service enforces ownership without any HTTP route', (t) => {
  const { store, service, a, b } = setup(t);
  const owned = service.create(a, { url: 'https://example.com/a' }, 'same-key').job;
  const other = service.create(b, { url: 'https://example.com/b' }, 'same-key').job;
  assert.notEqual(owned.id, other.id);
  assert.equal(store.get(owned.id, 'user-a')?.ownerId, 'user-a');
  assert.equal('ownerId' in owned, false);
  assert.equal(store.get(other.id, 'user-b')?.ownerId, 'user-b');
  assert.equal(service.create(a, { url: 'https://example.com/a' }, 'same-key').job.id, owned.id);
  assert.throws(
    () => service.create(a, { url: 'https://example.com/change' }, 'same-key'),
    errorCode(409),
  );
  assert.deepEqual(
    service.list(a).map((j) => j.id),
    [owned.id],
  );
  assert.deepEqual(
    service.list(b).map((j) => j.id),
    [other.id],
  );
  const claims: Array<NonNullable<ReturnType<SqliteJobStore['claim']>>> = [];
  for (const state of ['queued', 'running', 'completed'] as const) {
    if (state === 'running') claims.push(store.claim(10_000)!, store.claim(10_000)!);
    if (state === 'completed') {
      // Complete both trusted worker claims to verify terminal result isolation too.
      for (const claim of claims) {
        const result: AuditResult = {
          page: { url: claim.job.url, state: 'ok', bytes: 0, bytesComplete: true, attempts: 1 },
          resources: [],
          occurrences: [],
          issues: [],
          coverage: { complete: true, findings: [] },
        };
        store.complete(claim, result);
      }
    }
    assert.throws(() => service.get(a, other.id), errorCode(404));
    assert.throws(() => service.results(a, other.id), errorCode(404));
    assert.throws(() => service.get(b, owned.id), errorCode(404));
    assert.throws(() => service.results(b, owned.id), errorCode(404));
  }
  assert.equal(service.results(a, owned.id).result!.page.url, owned.url);
  assert.equal(service.results(b, other.id).result!.page.url, other.url);
  const failed = service.create(b, { url: 'https://example.com/failed' }).job;
  store.fail(
    store.claim(10_000)!,
    { code: 'page_failed', message: 'Private failure detail', retryable: false },
    0,
  );
  assert.throws(() => service.results(a, failed.id), errorCode(404));
  assert.equal(
    service.results(b, failed.id).attempts[0]!.failure!.message,
    'Private failure detail',
  );
  assert.throws(() => service.get(undefined, owned.id), errorCode(401));
  assert.throws(() => service.results('Bearer invalid', owned.id), errorCode(401));
  assert.throws(() => service.list({ userId: 'user-a' }), errorCode(401));
  assert.throws(
    () => service.create(a, { url: 'https://example.com/', ownerId: 'user-b' }),
    errorCode(400),
  );
});

test('HTTP endpoints reveal neither foreign jobs nor their results or attempt history', async (t) => {
  const { store, service, a, b } = setup(t);
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(() => app.close());
  const aJob = service.create(a, { url: 'https://example.com/a' }).job;
  const bJob = service.create(b, { url: 'https://example.com/b' }).job;
  for (const suffix of ['', '/results']) {
    const hidden = await app.inject({
      url: '/api/audits/' + bJob.id + suffix,
      headers: { authorization: a },
    });
    const missing = await app.inject({
      url: '/api/audits/' + randomUUID() + suffix,
      headers: { authorization: a },
    });
    assert.equal(hidden.statusCode, 404);
    assert.equal(hidden.body, missing.body);
    assert.ok(!hidden.body.includes(bJob.url));
    assert.equal(
      (await app.inject({ url: '/api/audits/' + bJob.id + suffix, headers: { authorization: b } }))
        .statusCode,
      200,
    );
  }
  const list = await app.inject({ url: '/api/audits', headers: { authorization: a } });
  assert.deepEqual(
    list.json<{ jobs: Array<{ id: string }> }>().jobs.map((j) => j.id),
    [aJob.id],
  );
  const created = await app.inject({
    method: 'POST',
    url: '/api/audits',
    headers: { authorization: b },
    payload: { url: 'https://example.com/new' },
  });
  assert.equal(created.statusCode, 202);
  assert.equal(store.get(created.json<{ id: string }>().id, 'user-b')!.ownerId, 'user-b');
  for (const authorization of [undefined, 'Bearer invalid', 'Basic anything']) {
    for (const url of [
      '/api/audits',
      '/api/audits/' + aJob.id,
      '/api/audits/' + aJob.id + '/results',
    ]) {
      const response = await app.inject({ url, headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['www-authenticate'], 'Bearer');
    }
  }
  const anonymousPost = await app.inject({
    method: 'POST',
    url: '/api/audits',
    payload: { url: 'https://example.com/' },
  });
  assert.equal(anonymousPost.statusCode, 401);
});

test('CORS accepts only the configured local frontend origins and does not bypass authentication', async (t) => {
  const { store, a } = setup(t);
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(() => app.close());
  const allowed = await app.inject({
    method: 'OPTIONS',
    url: '/api/audits',
    headers: {
      origin: 'http://127.0.0.1:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type,idempotency-key',
    },
  });
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
  assert.equal(allowed.headers['access-control-allow-credentials'], undefined);
  for (const origin of [
    'https://evil.example',
    'null',
    'http://127.0.0.1:5174',
    'http://localhost:5173.evil.example',
  ]) {
    const denied = await app.inject({ url: '/api/audits', headers: { origin, authorization: a } });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(
    (await app.inject({ url: '/api/audits', headers: { origin: 'http://localhost:5173' } }))
      .statusCode,
    401,
  );
  assert.equal((await app.inject('/api/health')).statusCode, 200);
});

test('request logging omits bearer tokens even in malformed input and query strings', async (t) => {
  const { store, a } = setup(t);
  let logs = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += String(chunk);
      callback();
    },
  });
  const app = buildApp({ store, logger: true, logStream: stream });
  t.after(() => app.close());
  const token = a.slice(7);
  await app.inject({ url: '/api/audits?token=' + token, headers: { authorization: a } });
  await app.inject({
    method: 'POST',
    url: '/api/audits',
    headers: { authorization: a },
    payload: { token },
  });
  await app.inject({
    url: '/api/audits/' + token,
    headers: { authorization: 'Bearer ' + token + 'bad' },
  });
  assert.ok(logs.length > 0);
  assert.ok(!logs.includes(token), 'Logs must omit raw credentials');
});

test('CLI prints a fresh token exactly once; SQLite and sidecars contain only its hash', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'jobs.sqlite');
  const run = promisify(execFile);
  const script = fileURLToPath(new URL('../../src/cli/provision-token.ts', import.meta.url));
  const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', script, 'cli-user'], {
    env: { ...process.env, AUDIT_DB_PATH: path },
  });
  const token = stdout.trim();
  assert.ok(
    /^wia_[A-Za-z0-9_-]{43}\r?\n$/.test(stdout),
    'CLI should output exactly one token line',
  );
  assert.ok(!stderr.includes(token), 'No token in stderr');
  const store = new SqliteJobStore(path);
  try {
    assert.equal(new DemoAuth(store).authenticate('Bearer ' + token), 'cli-user');
    const second = provisionToken(store, 'cli-user');
    assert.ok(second !== token, 'Each credential must be independently random');
    assert.equal(new DemoAuth(store).authenticate('Bearer ' + second), 'cli-user');
    assert.throws(() => provisionToken(store, '__legacy__'));
  } finally {
    store.close();
  }
  const raw = new Database(path, { readonly: true });
  try {
    const rows = raw.prepare('SELECT * FROM bearer_tokens').all() as Array<{
      token_hash: string;
      user_id: string;
    }>;
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.token_hash === tokenHash(token)));
    assert.ok(!JSON.stringify(rows).includes(token), 'No plaintext in database rows');
  } finally {
    raw.close();
  }
  for (const name of await readdir(dir)) {
    assert.ok(
      !(await readFile(join(dir, name))).includes(Buffer.from(token)),
      'No plaintext in database or sidecars',
    );
  }
});

test('migration quarantines pre-auth jobs without deleting their results', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'jobs.sqlite');
  // Reproduce v1 schema from the shipped migration, not an artificial mock schema.
  const source = await readFile(
    fileURLToPath(new URL('../../src/infrastructure/sqlite/migrations.ts', import.meta.url)),
    'utf8',
  );
  const v1 = /version: 1,\s+sql: `([\s\S]*?)`/.exec(source)?.[1];
  assert.ok(v1);
  const raw = new Database(path);
  raw.exec(v1);
  raw.exec(
    'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY) STRICT; INSERT INTO schema_migrations VALUES (1)',
  );
  const id = randomUUID();
  raw
    .prepare(
      `INSERT INTO jobs(id,url,idempotency_key,state,max_attempts,created_at,updated_at,available_at,progress_json,result_json)
    VALUES (?,?,'old-key','completed',3,0,0,0,?,?)`,
    )
    .run(
      id,
      'https://example.com/old',
      JSON.stringify({ phase: 'completed', inspected: 0, total: 0 }),
      JSON.stringify({
        page: {
          url: 'https://example.com/old',
          state: 'ok',
          bytes: 0,
          bytesComplete: true,
          attempts: 1,
        },
        occurrences: [],
        resources: [],
        issues: [],
        coverage: { complete: false, reasons: ['Historical scan limitation'] },
      }),
    );
  raw.close();
  const store = new SqliteJobStore(path);
  try {
    const auth = new DemoAuth(store);
    const service = new AuditService(store, auth, ['example.com']);
    const bearer = 'Bearer ' + provisionToken(store, 'new-user');
    assert.equal(store.get(id, '__legacy__')!.ownerId, '__legacy__');
    assert.deepEqual(store.results(id, '__legacy__')!.result!.coverage, {
      complete: false,
      findings: [{ code: 'legacy-notice', message: 'Historical scan limitation' }],
    });
    assert.deepEqual(service.list(bearer), []);
    assert.throws(() => service.get(bearer, id), errorCode(404));
    assert.throws(() => service.results(bearer, id), errorCode(404));
    assert.equal(
      service.create(bearer, { url: 'https://example.com/new' }, 'old-key').replayed,
      false,
    );
  } finally {
    store.close();
  }
});
