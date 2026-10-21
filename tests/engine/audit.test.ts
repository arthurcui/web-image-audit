import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { runAudit, createUrlPolicy } from '../../src/application/audit/index.js';
import type { AuditOptions } from '../../src/application/audit/index.js';
import { parseRetryAfter } from '../../src/application/audit/adapters/http-fetcher.js';
import { parseSrcset } from '../../src/application/audit/discover.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
async function fixture(t: TestContext, handler: Handler) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  // Explicit fixture-only approval, including its ephemeral port. No allow-all bypass.
  const options: AuditOptions = {
    approvedHosts: [new URL(origin).host],
    retryBaseMs: 5,
    maxRetryDelayMs: 100,
    maxRetries: 0,
    requestTimeoutMs: 1500,
  };
  return { origin, options };
}
function html(response: ServerResponse, body: string) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
}
function image(response: ServerResponse, bytes = 10) {
  response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(bytes));
}
function redirect(response: ServerResponse, target: string) {
  response.writeHead(302, { location: target }).end();
}

test('discovers static candidates, first base, duplicates, and independent alt semantics', async (t) => {
  const hits = new Map<string, number>();
  const f = await fixture(t, (req, res) => {
    const path = req.url!;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/start') return redirect(res, '/dir/page');
    if (path === '/dir/page')
      return html(
        res,
        `
      <base href="../assets/"><base href="/wrong/">
      <img src="shared.png" alt="First">
      <img src="./shared.png#fragment" alt="">
      <img src="shared.png">
      <picture><source srcset="small.png 400w, large.png 800w" media="(min-width: 600px)" type="image/png">
        <img src="fallback.png" srcset="one.png 1x, two.png 2x" data-src="lazy.png"
          data-srcset="lazy-small.png 1x, lazy-large.png 2x" data-original="original.png"
          data-lazy-src="later.png" alt="Responsive">
      </picture><a href="/never-follow">A link</a>`,
      );
    return image(res);
  });
  const result = await runAudit(f.origin + '/start', f.options);
  assert.equal(result.page.url, f.origin + '/dir/page');
  assert.equal(result.baseUrl, f.origin + '/assets/');
  assert.equal(result.occurrences.length, 4);
  assert.deepEqual(
    result.occurrences.slice(0, 3).map((o) => o.alt.state),
    ['text', 'empty', 'missing'],
  );
  assert.equal(result.issues.filter((i) => i.code === 'missing-alt').length, 1);
  assert.equal(hits.get('/assets/shared.png'), 1);
  assert.equal(hits.get('/never-follow'), undefined);
  assert.equal(result.resources.length, 11);
  assert.equal(result.occurrences[3]!.candidates.filter((c) => c.role === 'responsive').length, 4);
  assert.equal(result.occurrences[3]!.candidates[0]!.media, '(min-width: 600px)');
  assert.equal(result.coverage.complete, true);
  assert.ok(result.resources.every((r) => r.bytes === 10 && r.bytesComplete));
  assert.ok(!JSON.stringify(result).includes('"body"'));
});

test('without a base, resolves against final redirected page and coalesces redirect aliases', async (t) => {
  let downloads = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/start') return redirect(res, '/dir/page');
    if (req.url === '/dir/page')
      return html(res, '<img src="alias"><img src="final"><img src="alias2">');
    if (req.url === '/dir/alias' || req.url === '/dir/alias2') return redirect(res, '/dir/final');
    downloads++;
    image(res);
  });
  const result = await runAudit(f.origin + '/start', f.options);
  assert.equal(downloads, 1);
  assert.equal(result.resources.length, 3);
  assert.ok(result.resources.every((r) => r.url === f.origin + '/dir/final'));
});

test('policy denies unapproved hosts, credentials, and non-HTTP URLs before requests', async (t) => {
  let hits = 0;
  const f = await fixture(t, (_req, res) => {
    hits++;
    html(res, '');
  });
  const denied = await runAudit(f.origin, { approvedHosts: [] });
  assert.equal(denied.page.state, 'skipped');
  assert.equal(hits, 0);
  const policy = createUrlPolicy(f.options.approvedHosts);
  for (const value of [
    'file:///tmp/a',
    'data:image/png,abc',
    'ftp://127.0.0.1/a',
    'http://user:secret@' + new URL(f.origin).host,
    'https://example.com/x',
    'not a URL',
  ]) {
    assert.throws(() => policy(value));
  }
  assert.equal(policy(f.origin + '/a#x').href, f.origin + '/a');
});

test('validates page and image redirect targets; never forwards cookies or credentials', async (t) => {
  let rejectedHits = 0;
  const rejected = await fixture(t, (_req, res) => {
    rejectedHits++;
    image(res);
  });
  const approved = await fixture(t, (req, res) => {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    image(res);
  });
  const f = await fixture(t, (req, res) => {
    if (req.url === '/blocked-page') return redirect(res, rejected.origin);
    if (req.url === '/page') return html(res, '<img src="/bad"><img src="/good">');
    if (req.url === '/bad') return redirect(res, rejected.origin);
    res.writeHead(302, { location: approved.origin, 'set-cookie': 'secret=value' }).end();
  });
  const options = {
    ...f.options,
    approvedHosts: [...f.options.approvedHosts, ...approved.options.approvedHosts],
  };
  assert.equal((await runAudit(f.origin + '/blocked-page', options)).page.code, 'policy');
  const result = await runAudit(f.origin + '/page', options);
  assert.deepEqual(
    result.resources.map((r) => r.state),
    ['skipped', 'ok'],
  );
  assert.equal(rejectedHits, 0);
});

test('individual HTTP/type failures and oversize findings preserve successful resources', async (t) => {
  const hits = new Map<string, number>();
  const f = await fixture(t, (req, res) => {
    hits.set(req.url!, (hits.get(req.url!) ?? 0) + 1);
    if (req.url === '/')
      return html(res, '<img src="/404"><img src="/type"><img src="/big"><img src="/ok">');
    if (req.url === '/404') return res.writeHead(404).end();
    if (req.url === '/type') return html(res, 'Not an image');
    image(res, req.url === '/big' ? 50 : 10);
  });
  const result = await runAudit(f.origin, { ...f.options, oversizedBytes: 20, maxRetries: 2 });
  assert.deepEqual(
    result.resources.map((r) => r.code ?? 'ok'),
    ['http', 'content-type', 'ok', 'ok'],
  );
  assert.equal(result.resources[0]!.status, 404);
  assert.equal(hits.get('/404'), 1);
  assert.equal(hits.get('/type'), 1);
  assert.equal(result.resources[2]!.bytes, 50);
  assert.equal(result.resources[2]!.oversized, true);
  assert.equal(result.coverage.complete, false);
});

test('retries transient responses with backoff and honors Retry-After before retrying', async (t) => {
  const times: number[] = [];
  const f = await fixture(t, (req, res) => {
    if (req.url === '/') return html(res, '<img src="/retry">');
    times.push(Date.now());
    if (times.length === 1) return res.writeHead(503, { 'retry-after': '1' }).end();
    image(res);
  });
  const result = await runAudit(f.origin, { ...f.options, maxRetries: 2, maxRetryDelayMs: 1500 });
  assert.equal(result.resources[0]!.state, 'ok');
  assert.equal(result.resources[0]!.attempts, 2);
  assert.ok(times[1]! - times[0]! >= 1000, 'must not retry earlier than Retry-After');
});

test('exhausts bounded transient retries and defers long or invalid Retry-After', async (t) => {
  const counts = new Map<string, number>();
  const f = await fixture(t, (req, res) => {
    if (req.url === '/')
      return html(res, '<img src="/transient"><img src="/long"><img src="/invalid">');
    counts.set(req.url!, (counts.get(req.url!) ?? 0) + 1);
    res
      .writeHead(
        429,
        req.url === '/long'
          ? { 'retry-after': '3600' }
          : req.url === '/invalid'
            ? { 'retry-after': 'nonsense' }
            : {},
      )
      .end();
  });
  const result = await runAudit(f.origin, { ...f.options, maxRetries: 2 });
  assert.equal(counts.get('/transient'), 3);
  assert.equal(counts.get('/long'), 1);
  assert.equal(counts.get('/invalid'), 1);
  assert.deepEqual(
    result.resources.map((r) => r.state),
    ['failed', 'deferred', 'deferred'],
  );
  assert.equal(result.resources[1]!.retryAfterMs, 3_600_000);
});

test('Retry-After accepts seconds and dates, rejects malformed numeric delays', () => {
  assert.equal(parseRetryAfter('2', 0), 2000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT', 1000), 2000);
  assert.equal(parseRetryAfter('-1'), undefined);
  assert.equal(parseRetryAfter('0.5'), undefined);
});

test('bounds active image requests', async (t) => {
  let active = 0;
  let maximum = 0;
  const timers: NodeJS.Timeout[] = [];
  t.after(() => timers.forEach(clearTimeout));
  const f = await fixture(t, (req, res) => {
    if (req.url === '/')
      return html(res, Array.from({ length: 8 }, (_, i) => '<img src="/' + i + '">').join(''));
    active++;
    maximum = Math.max(maximum, active);
    timers.push(
      setTimeout(() => {
        active--;
        image(res);
      }, 25),
    );
  });
  const result = await runAudit(f.origin, { ...f.options, concurrency: 2 });
  assert.equal(maximum, 2);
  assert.equal(result.resources.length, 8);
});

test('deadlines cover headers and a stalled response body without failing siblings', async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/') return html(res, '<img src="/headers"><img src="/body"><img src="/ok">');
    if (req.url === '/headers') return;
    if (req.url === '/body') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write('x');
      return;
    }
    image(res);
  });
  const result = await runAudit(f.origin, { ...f.options, requestTimeoutMs: 150 });
  assert.deepEqual(
    result.resources.map((r) => r.code ?? 'ok'),
    ['timeout', 'timeout', 'ok'],
  );
  assert.equal(result.resources[1]!.bytes, 1);
  assert.equal(result.resources[1]!.bytesComplete, false);
});

test('response byte limits work without Content-Length; oversized page stops discovery', async (t) => {
  let imageHits = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/large-page') return html(res, '<img src="/big">' + ' '.repeat(200));
    if (req.url === '/') return html(res, '<img src="/big"><img src="/ok">');
    imageHits++;
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(Buffer.alloc(50));
      res.end(Buffer.alloc(50));
      return;
    }
    image(res);
  });
  const result = await runAudit(f.origin, { ...f.options, maxImageBytes: 20, oversizedBytes: 15 });
  assert.equal(result.resources[0]!.code, 'byte-limit');
  assert.ok(result.resources[0]!.bytes > 20);
  assert.equal(result.resources[0]!.bytesComplete, false);
  assert.equal(result.resources[0]!.oversized, true);
  assert.equal(result.resources[1]!.state, 'ok');
  imageHits = 0;
  const page = await runAudit(f.origin + '/large-page', { ...f.options, maxPageBytes: 100 });
  assert.equal(page.page.code, 'byte-limit');
  assert.equal(page.occurrences.length, 0);
  assert.equal(imageHits, 0);
});

test('reports resource, occurrence, and candidate coverage limits separately', async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/')
      return html(res, '<img src="/a" srcset="/b 1x, /c 2x"><img src="/d"><img src="/a">');
    image(res);
  });
  const resourceLimited = await runAudit(f.origin, { ...f.options, maxUniqueResources: 1 });
  assert.equal(resourceLimited.resources.length, 1);
  assert.equal(resourceLimited.occurrences[2]!.candidates[0]!.resourceId, 'resource-0');
  assert.ok(resourceLimited.coverage.findings.some((finding) => finding.code === 'resource-limit'));
  const occurrenceLimited = await runAudit(f.origin, { ...f.options, maxOccurrences: 1 });
  assert.equal(occurrenceLimited.occurrences.length, 1);
  assert.ok(
    occurrenceLimited.coverage.findings.some((finding) => finding.code === 'occurrence-limit'),
  );
  const candidateLimited = await runAudit(f.origin, { ...f.options, maxCandidates: 1 });
  assert.equal(candidateLimited.occurrences.flatMap((o) => o.candidates).length, 1);
  assert.ok(
    candidateLimited.coverage.findings.some((finding) => finding.code === 'candidate-limit'),
  );
});

test('bounds redirects and detects cycles for pages and image resources', async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/') return html(res, '<img src="/cycle"><img src="/chain/0">');
    if (req.url === '/cycle') return redirect(res, '/cycle');
    const n = Number(req.url!.split('/').at(-1));
    redirect(res, '/chain/' + (n + 1));
  });
  const result = await runAudit(f.origin, { ...f.options, maxRedirects: 2 });
  assert.deepEqual(
    result.resources.map((r) => r.code),
    ['redirect-loop', 'redirect-limit'],
  );
  const page = await runAudit(f.origin + '/chain/0', { ...f.options, maxRedirects: 2 });
  assert.equal(page.page.code, 'redirect-limit');
  assert.equal(page.page.attempts, 3);
});

test('srcset keeps data URL commas intact and rejects unsupported descriptors', async (t) => {
  const parsed = [...parseSrcset('data:image/png;base64,AAAA 1x, /ok 2x, /bad 2q, /bad2 1x 2x')];
  assert.equal(parsed[0]!.url, 'data:image/png;base64,AAAA');
  assert.deepEqual(
    parsed.map((p) => p.valid),
    [true, true, false, false],
  );
  const f = await fixture(t, (req, res) => {
    if (req.url === '/')
      return html(res, '<img src="" srcset="data:image/png;base64,AAAA 1x, /ok 2x, /bad 2q">');
    assert.equal(req.url, '/ok');
    image(res);
  });
  const result = await runAudit(f.origin, f.options);
  assert.equal(result.resources.length, 1);
  assert.equal(result.occurrences[0]!.candidates.filter((c) => c.skipped).length, 3);
  assert.equal(result.coverage.complete, false);
});

test('invalid first base falls back, and unsupported content encodings are explicit', async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/')
      return html(res, '<base href="http://["><base href="/ignored/"><img src="/encoded">');
    res
      .writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' })
      .end('fake gzip');
  });
  const result = await runAudit(f.origin, f.options);
  assert.equal(result.baseUrl, f.origin + '/');
  assert.equal(result.resources[0]!.code, 'encoding');
  assert.ok(result.coverage.findings.some((finding) => finding.code === 'invalid-base'));
});

test('invalid limit configuration fails before network access', async () => {
  await assert.rejects(
    runAudit('https://example.com', { approvedHosts: [], concurrency: 0 }),
    RangeError,
  );
  await assert.rejects(
    runAudit('https://example.com', { approvedHosts: [], maxRetries: 6 }),
    RangeError,
  );
});

test('retries connection resets but not unexpected partial responses', async (t) => {
  let resets = 0;
  let partials = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/') return html(res, '<img src="/reset"><img src="/partial">');
    if (req.url === '/reset') {
      resets++;
      if (resets === 1) {
        req.socket.destroy();
        return;
      }
      return image(res);
    }
    partials++;
    res.writeHead(206, { 'content-type': 'image/png', 'content-range': 'bytes 0-1/10' }).end('xx');
  });
  const result = await runAudit(f.origin, { ...f.options, maxRetries: 2 });
  assert.equal(resets, 2);
  assert.equal(partials, 1);
  assert.equal(result.resources[0]!.state, 'ok');
  assert.equal(result.resources[1]!.code, 'http');
});

test('uses HTTP charset for alt text and does not follow an unapproved base host', async (t) => {
  let otherHits = 0;
  const other = await fixture(t, (_req, res) => {
    otherHits++;
    image(res);
  });
  const f = await fixture(t, (_req, res) => {
    html(res, '<base href="' + other.origin + '/"><img src="x" alt="café 山">');
  });
  const result = await runAudit(f.origin, f.options);
  assert.deepEqual(result.occurrences[0]!.alt, { state: 'text', value: 'café 山' });
  assert.equal(result.resources.length, 0);
  assert.equal(otherHits, 0);
  assert.ok(result.occurrences[0]!.candidates[0]!.skipped);
});
