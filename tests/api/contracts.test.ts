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
    for (const job of body.jobs ?? [body]) assert.deepEqual(Object.keys(job).sort(), expected);
  }
});
