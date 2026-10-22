// Local diagnostic, not a timing gate. Uses only an in-memory database and synthetic data.
import { SqliteJobStore } from '../src/infrastructure/sqlite/job-store.js';
import { AuditService } from '../src/application/audit-service.js';
const store = new SqliteJobStore(':memory:');
try {
  const service = new AuditService(store, { authenticate: () => 'benchmark' }, ['example.com']);
  const { job } = service.create('', { url: 'https://example.com' });
  /** @type {import('../src/shared/audit.js').AuditResult} */
  const result = {
    page: { url: job.url, state: 'ok', bytes: 1, bytesComplete: true, attempts: 1 },
    resources: Array.from({ length: 100 }, (_, i) => ({
      id: 'r' + i,
      requestedUrl: 'https://example.com/' + i,
      url: 'https://example.com/' + i,
      state: 'ok',
      bytes: 1,
      bytesComplete: true,
      attempts: 1,
      oversized: false,
    })),
    occurrences: Array.from({ length: 500 }, (_, i) => ({
      id: 'o' + i,
      alt: { state: 'text', value: 'a'.repeat(100) },
      candidates: Array.from({ length: 4 }, (_, j) => ({
        rawUrl: 'https://example.com/' + j,
        attribute: 'srcset',
        element: 'img',
        role: 'responsive',
        resourceId: 'r' + j,
      })),
    })),
    issues: [],
    coverage: { complete: true, findings: [] },
  };
  const claim = store.claim(30000);
  if (!claim) throw new Error('Missing benchmark claim');
  store.complete(claim, result);
  /** @type {Array<[string,()=>unknown]>} */
  const cases = [
    ['summary', () => service.status('', job.id)],
    ['images20', () => service.page('', job.id, 'inventory', { limit: 20 })],
    ['internalFullSnapshot', () => store.results(job.id, 'benchmark')],
  ];
  console.log(
    JSON.stringify({
      sourceJsonBytes: Buffer.byteLength(JSON.stringify(result)),
      occurrences: 500,
      candidates: 2000,
    }),
  );
  for (const [name, run] of cases) {
    for (let i = 0; i < 10; i++) run();
    globalThis.gc?.();
    const initial = process.memoryUsage().heapUsed;
    let sampledMax = initial;
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      run();
      sampledMax = Math.max(sampledMax, process.memoryUsage().heapUsed);
    }
    console.log(
      JSON.stringify({
        name,
        meanMs: Number(((performance.now() - start) / 100).toFixed(3)),
        responseBytes: Buffer.byteLength(JSON.stringify(run())),
        sampledHeapGrowthBytes: sampledMax - initial,
      }),
    );
  }
} finally {
  store.close();
}
