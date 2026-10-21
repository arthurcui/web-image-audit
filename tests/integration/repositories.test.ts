import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteJobStore } from '../../src/infrastructure/job-store.js';
import type { AuditRepository, WorkerQueue } from '../../src/application/jobs.js';
import type { TokenRepository } from '../../src/application/auth.js';

test('audit repository requires owners at runtime and never exposes another owner through reads', t => {
  const store = new SqliteJobStore(':memory:');
  t.after(() => store.close());
  const audits: AuditRepository = store;
  const queue: WorkerQueue = store;
  const tokens: TokenRepository = store;
  tokens.saveToken('a'.repeat(64), 'alice');
  assert.equal(tokens.tokenUser('a'.repeat(64)), 'alice');
  const alice = audits.create('https://example.com/alice', 'same-key', 'alice').job;
  const bob = audits.create('https://example.com/bob', 'same-key', 'bob').job;
  assert.equal(audits.get(bob.id, 'alice'), undefined);
  assert.equal(audits.results(bob.id, 'alice'), undefined);
  assert.deepEqual(audits.list(10, 'alice').map(job => job.id), [alice.id]);
  assert.deepEqual(audits.list(10, 'alice', { createdAt: Number.MAX_SAFE_INTEGER, id: bob.id }).map(job => job.id), [alice.id]);
  for (const owner of [undefined, null, '', ' ']) {
    // Simulate untyped callers: missing identity must never select unscoped SQL.
    assert.throws(() => Reflect.apply(audits.get, audits, [alice.id, owner]), /Owner ID is required/);
    assert.throws(() => Reflect.apply(audits.results, audits, [alice.id, owner]), /Owner ID is required/);
    assert.throws(() => Reflect.apply(audits.list, audits, [10, owner]), /Owner ID is required/);
    assert.throws(() => Reflect.apply(audits.create, audits, ['https://example.com', undefined, owner]), /Owner ID is required/);
  }
  const claims = [queue.claim(30_000)!, queue.claim(30_000)!];
  assert.deepEqual(new Set(claims.map(claim => claim.job.ownerId)), new Set(['alice', 'bob']));
  assert.equal(queue.heartbeat(claims[0]!, 30_000), true);
});
