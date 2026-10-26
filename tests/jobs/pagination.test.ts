// Test result pagination, publication, and cursor consistency.
import { migrations } from '../../src/infrastructure/sqlite/migrations.js';
import { encodeCursor, decodeCursor } from '../../src/application/cursors.js';
import type { InventoryRow } from '../../src/shared/result-query.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { AuditService } from '../../src/application/audit-service.js';
import { JobError } from '../../src/application/jobs.js';
import { exportAudit } from '../../src/application/export-audit.js';
import { toCsv } from '../../src/shared/inventory.js';
import type { AuditResult } from '../../src/shared/audit.js';
import type { ResultCursor } from '../../src/shared/result-query.js';
import type { TestContext } from 'node:test';
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'wia-pages-'));
  let now = 1000;
  const path = join(dir, 'audit.sqlite');
  const store = new SqliteJobStore(path, () => now);
  const raw = new Database(path);
  const service = new AuditService(store, { authenticate: (value) => String(value) }, [
    'example.com',
  ]);
  t.after(async () => {
    raw.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    store,
    raw,
    service,
    advance: () => {
      now += 1000;
    },
  };
}
function fixture(count = 60): AuditResult {
  return {
    page: { url: 'https://example.com', state: 'ok', bytes: 0, bytesComplete: true, attempts: 1 },
    resources: [
      {
        id: 'good',
        url: 'https://example.com/good',
        requestedUrl: 'https://example.com/good',
        state: 'ok',
        bytes: 1,
        bytesComplete: true,
        attempts: 1,
        oversized: false,
      },
      {
        id: 'bad',
        url: 'https://example.com/bad',
        requestedUrl: 'https://example.com/bad',
        state: 'failed',
        status: 404,
        bytes: 600000,
        bytesComplete: true,
        attempts: 1,
        oversized: true,
      },
    ],
    occurrences: Array.from({ length: count }, (_, i) => ({
      id: 'o' + i,
      alt:
        i === count - 1
          ? { state: 'missing' as const }
          : { state: 'text' as const, value: '=SUM(1,2)\r\n"quoted"' },
      candidates: [
        {
          rawUrl: '/image',
          element: 'img' as const,
          attribute: 'src',
          role: 'fallback' as const,
          resourceId: i >= count - 5 ? 'bad' : 'good',
        },
      ],
    })),
    issues: [{ code: 'http', resourceId: 'bad', message: 'Broken\r\nimage' }],
    documents: [],
    coverage: {
      complete: false,
      findings: [{ code: 'resource-incomplete', message: 'Failed resource' }],
    },
  };
}
test('SQL pagination filters the entire inventory and binds cursors to owner, attempt, section and filter', async (t) => {
  const { store, raw, service } = await setup(t);
  const { job } = service.create('alice', { url: 'https://example.com' });
  store.complete(store.claim(10000)!, fixture());
  const first = service.inventoryPage('alice', job.id, { limit: 20 });
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 60);
  assert.ok(first.nextCursor);
  const all = [...first.items];
  let cursor: ResultCursor | null = first.nextCursor;
  while (cursor) {
    const page = service.inventoryPage('alice', job.id, { limit: 20, cursor });
    all.push(...page.items);
    cursor = page.nextCursor;
  }
  assert.equal(new Set(all.map((row) => row.key)).size, 60);
  const filtered = service.inventoryPage('alice', job.id, { filter: 'failed', limit: 2 });
  assert.equal(filtered.total, 5);
  assert.equal(filtered.items[0]!.occurrence.id, 'o55');
  assert.equal(
    service.inventoryPage('alice', job.id, { filter: 'missing' }).items[0]!.occurrence.id,
    'o59',
  );
  assert.equal(service.inventoryPage('alice', job.id, { filter: 'oversized' }).total, 5);
  assert.throws(() => service.inventoryPage('bob', job.id, { cursor: first.nextCursor }), {
    code: 'job_not_found',
  });
  assert.throws(
    () => service.inventoryPage('alice', job.id, { filter: 'missing', cursor: first.nextCursor }),
    { code: 'stale_cursor' },
  );
  assert.throws(
    () => service.storedPage('alice', job.id, { section: 'resources', cursor: first.nextCursor }),
    { code: 'stale_cursor' },
  );
  raw.prepare("UPDATE audits SET state='queued',available_at=0 WHERE id=?").run(job.id);
  const next = store.claim(10000)!;
  assert.throws(() => service.inventoryPage('alice', job.id, { cursor: first.nextCursor }), {
    code: 'stale_cursor',
  });
  store.complete(next, fixture(5));
  assert.throws(() => service.inventoryPage('alice', job.id, { cursor: first.nextCursor }), {
    code: 'stale_cursor',
  });
  assert.equal(service.overview('alice', job.id).header!.summary.htmlOccurrences, 5);
});
test('publication is atomic and stale workers cannot replace indexed rows', async (t) => {
  const { store, raw, service, advance } = await setup(t);
  const { job } = service.create('alice', { url: 'https://example.com' });
  const stale = store.claim(100)!;
  advance();
  const current = store.claim(10000)!;
  raw.exec(
    "CREATE TRIGGER fail_resource BEFORE INSERT ON image_resources BEGIN SELECT RAISE(ABORT,'test publication failure'); END",
  );
  assert.throws(() => store.complete(current, fixture()), /test publication failure/);
  assert.equal(service.overview('alice', job.id).available, false);
  assert.equal((raw.prepare('SELECT count(*) n FROM audit_results').get() as { n: number }).n, 0);
  raw.exec('DROP TRIGGER fail_resource');
  assert.equal(store.complete(current, fixture(5)), true);
  assert.equal(store.complete(stale, fixture(60)), false);
  assert.equal(service.overview('alice', job.id).header!.summary.htmlOccurrences, 5);
  assert.ok(
    !(raw.pragma('table_info(audits)') as Array<{ name: string }>).some(
      (c) => c.name === 'result_json',
    ),
  );
});
test('streamed JSON and CSV exports preserve complete data and formula escaping across batches', async (t) => {
  const { store, service } = await setup(t);
  const { job } = service.create('alice', { url: 'https://example.com' });
  const expected = fixture(250);
  store.complete(store.claim(10000)!, expected);
  let json = '';
  let chunks = 0;
  for await (const chunk of exportAudit(service, 'alice', job.id, 'json')) {
    json += chunk;
    chunks++;
  }
  assert.ok(chunks > 250);
  assert.deepEqual(JSON.parse(json), expected);
  let csv = '';
  for await (const chunk of exportAudit(service, 'alice', job.id, 'csv')) csv += chunk;
  assert.equal(csv, toCsv(expected));
  assert.throws(() => exportAudit(service, 'bob', job.id, 'json'), { code: 'job_not_found' });
});
test('recent cursor handles tied timestamps and inserted jobs using indexed limit-plus-one reads', async (t) => {
  const { service, raw, advance } = await setup(t);
  for (let i = 0; i < 6; i++) service.create('alice', { url: 'https://example.com/' + i });
  service.create('bob', { url: 'https://example.com/private' });
  const first = service.listPage('alice', 2);
  advance();
  const newest = service.create('alice', { url: 'https://example.com/new' }).job;
  const ids = first.jobs.map((j) => j.id);
  let before = first.nextCursor;
  while (before) {
    const next = service.listPage('alice', 2, before);
    ids.push(...next.jobs.map((j) => j.id));
    before = next.nextCursor;
  }
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.ok(!ids.includes(newest.id));
  for (const [sql, args, index] of [
    [
      'SELECT id FROM audits WHERE owner_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?',
      ['alice', 1000, 'z', 21],
      'jobs_owner_recent',
    ],
    [
      "SELECT id FROM image_resources WHERE job_id=? AND attempt=? AND state='failed' AND id>? ORDER BY id LIMIT ?",
      ['id', 1, -1, 21],
      'resources_outcome',
    ],
    [
      'SELECT ordinal FROM image_resources WHERE job_id=? AND attempt=? AND ordinal>? ORDER BY ordinal LIMIT ?',
      ['id', 1, -1, 21],
      'sqlite_autoindex_image_resources',
    ],
  ] as const) {
    const plan = JSON.stringify(raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args));
    assert.ok(plan.includes(index), plan);
    assert.ok(!plan.includes('TEMP B-TREE'), plan);
  }
});
test('cached summaries and byte-bounded pages do not reconstruct full result snapshots', async (t) => {
  const { store, service } = await setup(t);
  const { job } = service.create('alice', { url: 'https://example.com' });
  const data = fixture(500);
  data.occurrences = data.occurrences.map((o) => ({
    ...o,
    candidates: Array.from({ length: 4 }, () => o.candidates[0]!),
  }));
  store.complete(store.claim(10000)!, data);
  // If either optimized path calls the compatibility snapshot reader, this test fails.
  store.results = () => {
    throw new Error('Full snapshot read is forbidden');
  };
  const start = performance.now();
  for (let i = 0; i < 100; i++) service.resultsPage('alice', job.id, 'summary');
  t.diagnostic('cached summary mean ms: ' + ((performance.now() - start) / 100).toFixed(3));
  const page = service.resultsPage('alice', job.id, 'candidates', 20);
  assert.equal(page.summary?.candidates, 2000);
  assert.ok(page.items.length > 0);
  assert.ok(page.nextCursor);
  const cursor: ResultCursor = { ...page.nextCursor!, after: 100000 };
  assert.equal(service.resultsPage('alice', job.id, 'candidates', 20, cursor).nextCursor, null);
  assert.throws(
    () => service.resultsPage('alice', job.id, 'issues', 20, page.nextCursor!),
    (error: unknown) => error instanceof JobError && error.code === 'stale_cursor',
  );
});

test('opaque cursors carry filters, reject malformed/wrong-view tokens, and remain owner scoped', async (t) => {
  const { store, service, raw } = await setup(t);
  const { job } = service.create('alice', { url: 'https://example.com' });
  store.complete(store.claim(10000)!, fixture());
  const first = service.page('alice', job.id, 'inventory', { filter: 'failed', limit: 2 });
  assert.equal(typeof first.page.nextCursor, 'string');
  const next = service.page('alice', job.id, 'inventory', {
    cursor: first.page.nextCursor,
    limit: 2,
  });
  assert.equal(next.total, 5);
  assert.equal((next.items[0] as InventoryRow).occurrence.id, 'o57');
  assert.throws(() => service.page('bob', job.id, 'inventory', { cursor: first.page.nextCursor }), {
    code: 'job_not_found',
  });
  assert.throws(
    () =>
      service.page('alice', job.id, 'inventory', {
        cursor: first.page.nextCursor,
        filter: 'missing_alt',
      }),
    { code: 'stale_cursor' },
  );
  assert.throws(
    () => service.page('alice', job.id, 'resources', { cursor: first.page.nextCursor }),
    { code: 'invalid_request' },
  );
  for (const cursor of ['garbage', 'a'.repeat(2049), Buffer.from('{}').toString('base64url')])
    assert.throws(() => service.page('alice', job.id, 'inventory', { cursor }), {
      code: 'invalid_request',
    });
  const decoded = decodeCursor(first.page.nextCursor!);
  assert.equal(decoded.kind, 'results');
  if (decoded.kind === 'results')
    assert.throws(
      () =>
        service.page('alice', job.id, 'inventory', {
          cursor: encodeCursor({ ...decoded, position: { ...decoded.position, attempt: 999 } }),
        }),
      { code: 'stale_cursor' },
    );
  assert.throws(() => service.recent('alice', { cursor: first.page.nextCursor }), {
    code: 'invalid_request',
  });
  assert.throws(() => service.page('alice', job.id, 'inventory', { offset: 2 }), {
    code: 'invalid_request',
  });
  assert.deepEqual(raw.pragma('foreign_key_check'), []);
});

test('migration 6 preserves version-5 published data and removes duplicated snapshots', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'wia-upgrade-'));
  const path = join(dir, 'db.sqlite');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const old = new Database(path);
  old.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY) STRICT',
  );
  for (const migration of migrations.filter((m) => m.version < 6)) {
    old.exec(migration.sql);
    old.prepare('INSERT INTO schema_migrations VALUES (?)').run(migration.version);
  }
  const id = '11111111-1111-4111-8111-111111111111';
  const expected = fixture(4);
  old
    .prepare(
      "INSERT INTO jobs(id,url,state,attempts,max_attempts,created_at,updated_at,available_at,progress_json,owner_id) VALUES (?,?,'completed',1,3,1,1,1,?,'alice')",
    )
    .run(id, expected.page.url, JSON.stringify({ phase: 'completed', inspected: 2, total: 2 }));
  old
    .prepare('INSERT INTO audit_results VALUES (?,?,?)')
    .run(
      id,
      1,
      JSON.stringify({ metadata: { page: expected.page, coverage: { complete: false } } }),
    );
  const sections = {
    resources: expected.resources,
    occurrences: expected.occurrences,
    issues: expected.issues,
    documents: [],
    coverage: expected.coverage.findings,
  };
  for (const [section, rows] of Object.entries(sections))
    rows.forEach((row, i) =>
      old
        .prepare(`INSERT INTO audit_${section} VALUES (?,?,?,?,0,0,0)`)
        .run(id, 1, i, JSON.stringify(row)),
    );
  old.close();
  const upgraded = new SqliteJobStore(path);
  const check = new Database(path);
  try {
    assert.deepEqual(upgraded.results(id, 'alice')!.result, expected);
    assert.deepEqual(check.pragma('foreign_key_check'), []);
    const tables = (
      check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((v) => v.name);
    for (const removed of [
      'jobs',
      'job_attempts',
      'audit_inventory',
      'audit_candidates',
      'audit_occurrences',
      'audit_resources',
      'audit_coverage',
    ])
      assert.ok(!tables.includes(removed));
    assert.equal(
      (check.prepare('SELECT count(*) n FROM image_candidates').get() as { n: number }).n,
      4,
    );
  } finally {
    check.close();
    upgraded.close();
  }
});
