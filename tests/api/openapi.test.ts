import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../../src/api/app.js';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { provisionToken } from '../../src/application/auth.js';

test('OpenAPI references resolve, documented routes exist, and actual responses match schemas', async (t) => {
  const spec = JSON.parse(
    await readFile(new URL('../../docs/openapi.json', import.meta.url), 'utf8'),
  ) as {
    openapi: string;
    paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  assert.equal(spec.openapi, '3.1.1');
  function checkRefs(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        assert.equal(typeof child, 'string');
        const parts = (child as string).split('/');
        assert.equal(parts.shift(), '#');
        let target: unknown = spec;
        for (const part of parts) target = (target as Record<string, unknown>)?.[part];
        assert.ok(target, 'Unresolved reference: ' + child);
      } else checkRefs(child);
    }
  }
  checkRefs(spec);
  const store = new SqliteJobStore(':memory:');
  const authorization = 'Bearer ' + provisionToken(store, 'contract-user');
  const app = buildApp({ store, approvedHosts: ['example.com'] });
  t.after(async () => {
    await app.close();
    store.close();
  });
  for (const [path, operations] of Object.entries(spec.paths))
    for (const method of Object.keys(operations)) {
      assert.ok(method === 'get' || method === 'post');
      assert.ok(
        app.hasRoute({
          method: method === 'get' ? 'GET' : 'POST',
          url: path.replace('{id}', ':id'),
        }),
        method + ' ' + path,
      );
    }
  // Compile every component with the same JSON Schema validator used by Fastify.
  // These test-only routes do not exist in the application.
  const definitions = JSON.parse(
    JSON.stringify(spec.components.schemas).replaceAll('#/components/schemas/', '#/definitions/'),
  ) as Record<string, unknown>;
  for (const name of Object.keys(definitions))
    app.post(
      '/contract/' + name,
      { schema: { body: { $ref: '#/definitions/' + name, definitions } } },
      async () => ({ valid: true }),
    );
  await app.ready();
  async function conforms(name: string, value: unknown) {
    const reply = await app.inject({
      method: 'POST',
      url: '/contract/' + name,
      payload: JSON.stringify(value),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(reply.statusCode, 200, name + ': ' + reply.body);
  }
  await conforms('Health', (await app.inject('/api/health')).json());
  const readiness = await app.inject('/api/ready');
  assert.equal(readiness.statusCode, 503);
  await conforms('Readiness', readiness.json());
  await conforms('Error', (await app.inject('/api/audits')).json());
  const payload = { url: 'https://example.com/', scan: { mode: 'static' } };
  await conforms('CreateAudit', payload);
  const created = await app.inject({
    method: 'POST',
    url: '/api/audits',
    headers: { authorization },
    payload,
  });
  assert.equal(created.statusCode, 202);
  await conforms('CreatedAudit', created.json());
  const id = created.json<{ id: string }>().id;
  const get = async (path: string) =>
    (await app.inject({ url: path, headers: { authorization } })).json();
  await conforms('AuditStatus', await get('/api/audits/' + id));
  await conforms('AuditPage', await get('/api/audits'));
  const endpoints = [
    ['images', 'ImagesPage'],
    ['resources', 'ResourcesPage'],
    ['documents', 'DocumentsPage'],
    ['issues', 'IssuesPage'],
  ] as const;
  for (const [path, schema] of endpoints)
    await conforms(schema, await get('/api/audits/' + id + '/' + path));
  const claim = store.claim(10000)!;
  store.complete(claim, {
    page: { url: 'https://example.com/', state: 'ok', bytes: 1, bytesComplete: true, attempts: 1 },
    resources: [
      {
        id: 'r1',
        url: 'https://example.com/a.png',
        requestedUrl: 'https://example.com/a.png',
        state: 'failed',
        status: 404,
        bytes: 0,
        bytesComplete: true,
        attempts: 1,
        oversized: false,
      },
    ],
    occurrences: [
      {
        id: 'o1',
        alt: { state: 'missing' },
        candidates: [
          {
            element: 'img',
            role: 'fallback',
            attribute: 'src',
            rawUrl: '/a.png',
            resourceId: 'r1',
          },
        ],
      },
    ],
    documents: [{ id: 'd1', kind: 'page', url: 'https://example.com/', depth: 0, state: 'ok' }],
    issues: [{ code: 'http', message: 'HTTP 404', resourceId: 'r1' }],
    coverage: {
      complete: false,
      findings: [{ code: 'resource-incomplete', message: 'A resource failed' }],
    },
  });
  await conforms('AuditStatus', await get('/api/audits/' + id));
  for (const [path, schema] of endpoints)
    await conforms(schema, await get('/api/audits/' + id + '/' + path));
  await conforms('AuditExport', await get('/api/audits/' + id + '/export?format=json'));
  // Confirm the contract rejects persistence-only fields rather than documenting them.
  const invalid = await app.inject({
    method: 'POST',
    url: '/contract/AuditJob',
    payload: { ...(await get('/api/audits')).items[0], ownerId: 'private' },
  });
  assert.equal(invalid.statusCode, 400);
});
