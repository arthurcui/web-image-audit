import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/api/app.js';
import { isHealthResponse } from '../../src/shared/health.js';

test('health endpoint returns the public JSON contract', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(response.json(), { status: 'ok', service: 'website-image-audit' });
  assert.ok(isHealthResponse(response.json()));
});

test('audit submission requires authentication', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/audits',
    payload: { url: 'https://example.com' },
  });
  assert.equal(response.statusCode, 401);
});
