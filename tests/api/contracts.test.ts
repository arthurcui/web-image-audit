import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuditSchema } from '../../src/shared/inputs.js';
import { AuditService } from '../../src/application/audit-service.js';
import { JobError } from '../../src/application/jobs.js';
import { DemoAuth, provisionToken } from '../../src/application/auth.js';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { buildApp } from '../../src/api/app.js';

test('shared validation and service reject malformed payloads before storage; errors have no HTTP fields', async (t) => {
  const store = new SqliteJobStore(':memory:');
  const authorization = 'Bearer ' + provisionToken(store, 'alice');
  const service = new AuditService(store, new DemoAuth(store), ['example.com']);
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const invalid = [
    null,
    { url: 'https://example.com', userId: 'other' },
    { url: 'file:///private' },
    { url: 'https://user:pass@example.com' },
    { url: 'https://example.com', scan: null },
    { url: 'https://example.com', scan: { maxPages: 21 } },
    { url: 'https://example.com', scan: { maxPages: '2' } },
    { url: 'https://example.com', scan: { unexpected: true } },
  ];
  for (const input of invalid) {
    assert.equal(createAuditSchema.safeParse(input).success, false);
    assert.throws(
      () => service.create(authorization, input),
      (error) =>
        error instanceof JobError && error.code === 'invalid_request' && !('statusCode' in error),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/audits',
      headers: { authorization, 'content-type': 'application/json' },
      payload: JSON.stringify(input),
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(store.list(100, 'alice').length, 0);
  const accepted = service.create(authorization, {
    url: 'https://example.com',
    scan: { mode: 'crawl' },
  }).job;
  assert.deepEqual(accepted.scan, {
    mode: 'crawl',
    includeIframes: false,
    maxPages: 10,
    maxDepth: 2,
  });
});

test('service and REST job DTOs exclude persistence and lease fields, including during active claims', async (t) => {
  const store = new SqliteJobStore(':memory:');
  const authorization = 'Bearer ' + provisionToken(store, 'alice');
  const service = new AuditService(store, new DemoAuth(store), ['example.com']);
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const created = service.create(authorization, { url: 'https://example.com' }).job;
  const claim = store.claim(10_000)!;
  assert.equal(claim.job.ownerId, 'alice');
  assert.ok(claim.token);
  const expected = [
    'id',
    'url',
    'state',
    'attempts',
    'maxAttempts',
    'createdAt',
    'updatedAt',
    'progress',
    'lastError',
    'scan',
  ].sort();
  for (const job of [
    created,
    service.get(authorization, created.id),
    ...service.list(authorization),
    service.results(authorization, created.id).job,
  ])
    assert.deepEqual(Object.keys(job).sort(), expected);
  for (const path of ['/api/audits/' + created.id, '/api/audits']) {
    const response = await app.inject({ url: path, headers: { authorization } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    for (const job of body.items ?? [body])
      assert.deepEqual(
        Object.keys(job)
          .filter((k) => k !== 'publishedResult')
          .sort(),
        expected,
      );
  }
});

test('REST recent cursors are owner-scoped and bounded result pages match the shared service', async (t) => {
  const store = new SqliteJobStore(':memory:');
  const authorization = 'Bearer ' + provisionToken(store, 'alice');
  const other = 'Bearer ' + provisionToken(store, 'bob');
  const service = new AuditService(store, new DemoAuth(store), ['example.com']);
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(async () => {
    await app.close();
    store.close();
  });
  for (let i = 0; i < 5; i++) service.create(authorization, { url: 'https://example.com/' + i });
  const foreign = service.create(other, { url: 'https://example.com/private' }).job;
  const get = (url: string) => app.inject({ url, headers: { authorization } });
  const ids: string[] = [];
  let before: string | null = null;
  do {
    const response = await get(
      '/api/audits?limit=2' + (before ? '&cursor=' + encodeURIComponent(before) : ''),
    );
    assert.equal(response.statusCode, 200);
    const body = response.json();
    ids.push(...body.items.map((job: { id: string }) => job.id));
    before = body.page.nextCursor;
  } while (before);
  assert.equal(new Set(ids).size, 5);
  assert.equal(ids.length, 5);
  assert.ok(!ids.includes(foreign.id));
  for (const query of ['before=bad', 'before=%7B%7D', 'limit=0', 'limit=101'])
    assert.equal((await get('/api/audits?' + query)).statusCode, 400);
  const claim = store.claim(10000)!;
  // Use the claim owner so this test does not depend on random-ID ordering within a millisecond.
  const owner = claim.job.ownerId === 'alice' ? authorization : other;
  const result = {
    page: { url: claim.job.url, state: 'ok' as const, bytes: 0, bytesComplete: true, attempts: 1 },
    resources: [],
    occurrences: [],
    issues: Array.from({ length: 25 }, (_, i) => ({
      code: 'http' as const,
      message: String(i) + 'x'.repeat(1000),
    })),
    coverage: { complete: false, findings: [] },
  };
  store.complete(claim, result);
  const firstPage = await app.inject({
    url: '/api/audits/' + claim.job.id + '/issues?&limit=20',
    headers: { authorization: owner },
  });
  assert.equal(firstPage.statusCode, 200);
  const body = firstPage.json();
  assert.equal(body.items.length, 20);
  assert.equal(typeof body.page.nextCursor, 'string');
  assert.equal(body.total, 25);
  assert.deepEqual(body, service.page(owner, claim.job.id, 'issues', { limit: 20 }));
  assert.ok(Buffer.byteLength(firstPage.body) < 25000);
  const last = service.page(owner, claim.job.id, 'issues', {
    limit: 20,
    cursor: body.page.nextCursor,
  });
  assert.equal(last.items.length, 5);
  assert.equal(last.page.nextCursor, null);
  assert.equal((await get('/api/audits/' + foreign.id + '/issues?')).statusCode, 404);
  for (const query of ['limit=101', 'offset=-1', 'section=unknown'])
    assert.equal(
      (
        await app.inject({
          url: '/api/audits/' + claim.job.id + '/issues?' + query,
          headers: { authorization: owner },
        })
      ).statusCode,
      400,
    );
});
