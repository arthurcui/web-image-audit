// Test database and worker readiness transitions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { buildApp } from '../../src/api/app.js';
import { workerStaleAfterMs } from '../../src/application/readiness.js';
import { startWorkerPresence } from '../../src/worker/presence.js';

test('readiness distinguishes missing, fresh, stale and draining workers across database connections', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wia-ready-'));
  const path = join(directory, 'jobs.sqlite');
  let now = 100_000;
  const apiStore = new SqliteJobStore(path, () => now);
  const workerStore = new SqliteJobStore(path, () => now);
  const app = buildApp({ store: apiStore });
  t.after(async () => {
    await app.close();
    workerStore.close();
    apiStore.close();
    await rm(directory, { recursive: true, force: true });
  });
  const probe = () => app.inject('/api/ready');
  let response = await probe();
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json().checks, { database: 'ready', worker: 'unavailable' });
  workerStore.recordWorkerHeartbeat('worker-a');
  assert.equal((await probe()).statusCode, 200);
  now += workerStaleAfterMs;
  assert.equal((await probe()).statusCode, 503);
  const stopA = startWorkerPresence(workerStore, () => assert.fail('Unexpected heartbeat failure'));
  const stopB = startWorkerPresence(workerStore, () => assert.fail('Unexpected heartbeat failure'));
  t.after(() => {
    stopA();
    stopB();
  });
  stopA();
  assert.equal((await probe()).statusCode, 200, 'another live worker remains ready');
  stopB();
  assert.equal((await probe()).statusCode, 503, 'draining workers are no longer ready');
  const lock = new Database(path);
  try {
    lock.exec('BEGIN IMMEDIATE');
    response = await probe();
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      checks: { database: 'unavailable', worker: 'unknown' },
    });
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(!response.body.includes(path));
  } finally {
    lock.exec('ROLLBACK');
    lock.close();
  }
});

test('unavailable database returns sanitized readiness failure without breaking liveness', async (t) => {
  const store = new SqliteJobStore(':memory:');
  const app = buildApp({ store });
  t.after(() => app.close());
  store.close();
  assert.equal((await app.inject('/api/ready')).statusCode, 503);
  assert.equal((await app.inject('/api/health')).statusCode, 200);
});

test(
  'separate idle worker publishes and renews readiness heartbeat',
  { timeout: 15_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'wia-worker-ready-'));
    const path = join(directory, 'jobs.sqlite');
    const store = new SqliteJobStore(path);
    const child = fork(resolve('src/worker/main.ts'), [], {
      execArgv: ['--import', 'tsx'],
      stdio: 'ignore',
      env: {
        ...process.env,
        AUDIT_FIXTURE_MODE: '0',
        AUDIT_DB_PATH: path,
        AUDIT_APPROVED_HOSTS: '',
      },
    });
    const exited = once(child, 'exit');
    t.after(async () => {
      child.kill();
      await exited;
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    for (let i = 0; i < 100 && !store.probeReadiness().workerReady; i++) await sleep(50);
    assert.equal(store.probeReadiness().workerReady, true);
    const db = new Database(path);
    try {
      const first = (
        db.prepare('SELECT MAX(heartbeat_at) AS time FROM worker_heartbeats').get() as {
          time: number;
        }
      ).time;
      await sleep(5500);
      const second = (
        db.prepare('SELECT MAX(heartbeat_at) AS time FROM worker_heartbeats').get() as {
          time: number;
        }
      ).time;
      assert.ok(second > first, 'idle worker renews its heartbeat');
    } finally {
      db.close();
    }
  },
);
