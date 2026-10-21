import test from 'node:test';
import assert from 'node:assert/strict';
import { isHealthResponse } from '../../src/shared/health.js';

test('browser contract validation rejects malformed responses', () => {
  for (const value of [
    null,
    [],
    'ok',
    {},
    { status: 'ok' },
    { status: 'error', service: 'website-image-audit' },
    { status: 'ok', service: 'other' },
  ]) {
    assert.equal(isHealthResponse(value), false);
  }
});
