import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserExecutable } from '../../src/application/audit/adapters/browser-config.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { runAudit } from '../../src/application/audit/index.js';
import {
  renderFailure,
  RenderError,
} from '../../src/application/audit/adapters/browser-renderer.js';
import { defaultScan } from '../../src/shared/scan.js';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { AuditService } from '../../src/application/audit-service.js';
import { AuditWorker } from '../../src/worker/runner.js';

const html = (res: ServerResponse, body: string) =>
  res.writeHead(200, { 'content-type': 'text/html' }).end(body);
async function fixture(t: TestContext) {
  const hits = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = req.url!;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/')
      return html(
        res,
        `<base href="/assets/"><script src="/insert.js"></script><img src="shared.png" alt="root"><a href="/child">child</a><a href="/child#again">duplicate</a><iframe src="/frame"></iframe><iframe srcdoc="&lt;img src='inline.png' alt=''&gt;"></iframe>`,
      );
    if (path === '/insert.js')
      return res
        .writeHead(200, { 'content-type': 'application/javascript' })
        .end(
          `setTimeout(() => { const img=document.createElement('img'); img.src='/dynamic.png'; img.alt='dynamic'; document.body.append(img); }, 50); fetch('/data').then(r=>r.json()).then(v=>{const img=document.createElement('img');img.src=v.src; document.body.append(img)});`,
        );
    if (path === '/data')
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"src":"/data.png"}');
    if (path === '/child')
      return html(
        res,
        '<img src="/assets/shared.png" alt="child"><a href="/">cycle</a><a href="/deep">deep</a><iframe src="/frame"></iframe>',
      );
    if (path === '/deep') return html(res, '<img src="/deep.png">');
    if (path === '/frame')
      return html(res, '<img src="/assets/shared.png" alt="frame"><iframe src="/nested"></iframe>');
    if (path === '/nested')
      return html(res, '<img src="/nested.png"><iframe src="/too-deep"></iframe>');
    if (path === '/blocked')
      return html(
        res,
        '<script src="http://localhost:1/blocked.js"></script><iframe src="http://localhost:1/frame"></iframe><img src="/ok.png">',
      );
    if (path === '/partial') return html(res, '<a href="/bad">bad</a><img src="/ok.png">');
    if (path === '/bad') return res.writeHead(500).end();
    if (path === '/huge')
      return html(res, `<body><script>document.body.append('x'.repeat(5000))</script></body>`);
    if (path === '/redirect') return res.writeHead(302, { location: '/' }).end();
    if (path.endsWith('.png'))
      return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(10));
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = 'http://127.0.0.1:' + address.port;
  return {
    url,
    hits,
    options: { approvedHosts: [new URL(url).host], maxRetries: 0, requestTimeoutMs: 1000 },
  };
}

test('rendered crawl discovers delayed JS/data images, iframe/srcdoc images, provenance and globally shared resources', async (t) => {
  const f = await fixture(t);
  const result = await runAudit(f.url + '/redirect', {
    ...f.options,
    scan: { ...defaultScan, mode: 'crawl', includeIframes: true, maxPages: 2, maxDepth: 1 },
  });
  assert.equal(result.page.state, 'ok');
  assert.ok(result.resources.some((r) => r.requestedUrl.endsWith('/dynamic.png')));
  assert.ok(result.resources.some((r) => r.requestedUrl.endsWith('/data.png')));
  assert.ok(result.resources.some((r) => r.requestedUrl.endsWith('/assets/inline.png')));
  assert.ok(result.resources.some((r) => r.requestedUrl.endsWith('/nested.png')));
  const shared = result.occurrences.filter((o) =>
    o.candidates.some((c) => c.url?.endsWith('/assets/shared.png')),
  );
  assert.deepEqual(shared.map((o) => (o.alt.state === 'text' ? o.alt.value : '')).sort(), [
    'child',
    'frame',
    'root',
  ]);
  assert.equal(new Set(shared.map((o) => o.documentId)).size, 3);
  assert.equal(f.hits.get('/assets/shared.png'), 1);
  assert.equal(f.hits.get('/deep'), undefined);
  assert.equal(f.hits.get('/too-deep'), undefined);
  assert.equal(f.hits.get('/frame'), 1);
  assert.ok(result.coverage.findings.some((finding) => finding.code === 'crawl-limit'));
  assert.ok(result.coverage.findings.some((finding) => finding.code === 'iframe-limit'));
});

test('static mode stays static; iframe opt-in uses bounded independent documents', async (t) => {
  const f = await fixture(t);
  const single = await runAudit(f.url + '/', f.options);
  assert.equal(single.occurrences.length, 1);
  assert.equal(f.hits.get('/insert.js'), undefined);
  const frames = await runAudit(f.url + '/', {
    ...f.options,
    scan: { ...defaultScan, includeIframes: true },
    maxUniqueResources: 1,
    maxOccurrences: 2,
  });
  assert.equal(frames.resources.length, 1);
  assert.equal(frames.occurrences.length, 2);
  assert.equal(f.hits.get('/child'), undefined);
  assert.equal(frames.coverage.complete, false);
});

test('rendering enforces dependency policy and DOM byte limits; failed child pages preserve root results', async (t) => {
  const f = await fixture(t);
  const blocked = await runAudit(f.url + '/blocked', {
    ...f.options,
    scan: { ...defaultScan, mode: 'rendered', includeIframes: true },
  });
  assert.equal(blocked.resources.length, 1);
  assert.ok(
    blocked.coverage.findings.some((finding) => finding.code === 'browser-dependency-failed'),
  );
  assert.ok(
    blocked.coverage.findings.some((finding) => finding.code === 'linked-document-rejected'),
  );
  const huge = await runAudit(f.url + '/huge', {
    ...f.options,
    scan: { ...defaultScan, mode: 'rendered' },
    maxPageBytes: 1000,
  });
  assert.equal(huge.page.state, 'failed');
  assert.equal(huge.page.code, 'dom-limit');
  assert.match(huge.page.message!, /DOM byte limit/);
  const partial = await runAudit(f.url + '/partial', {
    ...f.options,
    scan: { ...defaultScan, mode: 'crawl' },
  });
  assert.equal(partial.page.state, 'ok');
  assert.equal(partial.resources.length, 1);
  assert.ok(partial.documents?.some((d) => d.state === 'failed'));
});

test('scan settings persist, participate in idempotency, validate centrally and reach the worker', async (t) => {
  const store = new SqliteJobStore(':memory:');
  t.after(() => store.close());
  const service = new AuditService(store, { authenticate: () => 'alice' }, ['example.com']);
  const scan = { ...defaultScan, mode: 'rendered' as const, includeIframes: true };
  const first = service.create('token', { url: 'https://example.com', scan }, 'key');
  assert.deepEqual(store.get(first.job.id, 'alice')?.scan, scan);
  assert.equal(
    service.create('token', { url: 'https://example.com', scan }, 'key').job.id,
    first.job.id,
  );
  assert.throws(
    () => service.create('token', { url: 'https://example.com' }, 'key'),
    /different audit payload/,
  );
  assert.throws(
    () => service.create('token', { url: 'https://example.com', scan: { maxPages: 1000 } }),
    { code: 'invalid_request' },
  );
  const worker = new AuditWorker(store, {
    auditOptions: { approvedHosts: ['example.com'] },
    audit: async (_url, options) => {
      assert.deepEqual(options.scan, scan);
      return {
        page: {
          url: 'https://example.com',
          state: 'ok',
          bytes: 0,
          bytesComplete: true,
          attempts: 1,
        },
        occurrences: [],
        resources: [],
        issues: [],
        coverage: { complete: true, findings: [] },
      };
    },
  });
  await worker.runOnce();
  assert.equal(store.get(first.job.id, 'alice')?.state, 'completed');
});

test('missing configured Chromium reports an actionable error while static audits still work', async (t) => {
  const f = await fixture(t);
  const originalCwd = process.cwd();
  const isolated = mkdtempSync(join(tmpdir(), 'wia-browser-config-'));
  process.chdir(isolated);
  const previous = process.env['AUDIT_BROWSER_EXECUTABLE'];
  process.env['AUDIT_BROWSER_EXECUTABLE'] = 'C:/missing-wia-browser/chrome.exe';
  try {
    const rendered = await runAudit(f.url + '/', {
      ...f.options,
      scan: { ...defaultScan, mode: 'rendered' },
    });
    assert.equal(rendered.page.code, 'browser-missing');
    assert.match(rendered.page.message!, /npm run browser:install/);
    assert.ok(rendered.coverage.findings.some((finding) => finding.code === 'render-failed'));
    assert.ok(!rendered.page.message!.includes('missing-wia-browser'));
    const plain = await runAudit(f.url + '/', f.options);
    assert.equal(plain.page.state, 'ok');
  } finally {
    process.chdir(originalCwd);
    rmSync(isolated, { recursive: true, force: true });
    if (previous === undefined) delete process.env['AUDIT_BROWSER_EXECUTABLE'];
    else process.env['AUDIT_BROWSER_EXECUTABLE'] = previous;
  }
});

test('render diagnostics distinguish startup, timeouts, navigation and DOM limits without raw output', () => {
  assert.equal(renderFailure(new Error('spawn EACCES secret'), 'launch').code, 'browser-launch');
  const timeout = new Error('private page data');
  timeout.name = 'TimeoutError';
  assert.equal(renderFailure(timeout, 'navigation').code, 'render-timeout');
  assert.equal(renderFailure(new Error('closed'), 'snapshot', true).code, 'render-timeout');
  assert.equal(
    renderFailure(new Error('private page data'), 'navigation').code,
    'render-navigation',
  );
  const limit = new RenderError('dom-limit', 'DOM limit');
  assert.equal(renderFailure(limit, 'snapshot'), limit);
  assert.ok(
    !renderFailure(new Error('private page data'), 'snapshot').message.includes(
      'private page data',
    ),
  );
});

test('project browser manifest overrides stale inherited cache paths and rejects malformed configuration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wia-browser-manifest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(browserExecutable({}, root), undefined);
  assert.equal(
    browserExecutable({ AUDIT_BROWSER_EXECUTABLE: 'old.exe' }, root),
    join(root, 'old.exe'),
  );
  mkdirSync(join(root, 'data'));
  writeFileSync(
    join(root, 'data/browser-runtime.json'),
    JSON.stringify({ executablePath: 'data/browsers/chrome.exe' }),
  );
  assert.equal(
    browserExecutable({ AUDIT_BROWSER_EXECUTABLE: 'old.exe' }, root),
    join(root, 'data/browsers/chrome.exe'),
  );
  writeFileSync(join(root, 'data/browser-runtime.json'), '{}');
  assert.throws(() => browserExecutable({}, root), /Invalid project browser/);
});
