import { summarizeAudit } from '../../src/shared/summary.js';
import type { AuditResult } from '../../src/shared/audit.js';
import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AuditJob, AuditStatus } from '../../src/shared/jobs.js';
import { fixtureToken, fixtureUrl } from './fixture.js';

async function connect(page: Page) {
  await page.goto('/');
  await page.getByLabel('Local demo token').fill(fixtureToken);
  await page.getByLabel('Local demo token').press('Tab');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start audit', exact: true })).toBeVisible();
}
function job(id: string, state: AuditJob['state'] = 'completed'): AuditStatus {
  return {
    id,
    url: 'https://example.com/' + id,
    state,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
    publishedResult:
      state === 'completed'
        ? {
            attempt: 1,
            summary: summarizeAudit(emptyResult),
            metadata: { page: emptyResult.page, coverage: { complete: true } },
            counts: {
              summary: 0,
              resources: 0,
              occurrences: 0,
              candidates: 0,
              issues: 0,
              documents: 0,
              coverage: 0,
              inventory: 0,
            },
          }
        : null,
    progress: {
      phase: state === 'running' ? 'inspecting-images' : state,
      inspected: 0,
      total: null,
    },
  };
}
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const emptyResult: AuditResult = {
  page: { url: 'https://example.com', state: 'ok', bytes: 0, bytesComplete: true, attempts: 1 },
  occurrences: [],
  resources: [],
  issues: [],
  coverage: { complete: true, findings: [] },
};
async function respond(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, json: value });
}

test('real submit → separate worker → results, filters, exports and memory-only credentials', async ({
  page,
}, info) => {
  const previewRequests: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'image' || req.url().startsWith('http://127.0.0.1:3102'))
      previewRequests.push(req.url());
  });
  await connect(page);
  await page.getByLabel('Webpage URL').fill(fixtureUrl);
  await page.getByRole('button', { name: 'Start audit' }).click();
  await expect(page.getByRole('heading', { name: 'Audit detail' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Image inventory' })).toBeVisible({
    timeout: 20_000,
  });
  const detail = page.getByRole('region', { name: 'Audit detail', exact: true });
  await expect(
    detail.locator('.metrics div').filter({ hasText: 'Unique resources' }).locator('dd'),
  ).toHaveText('3');
  await expect(
    detail.locator('.metrics div').filter({ hasText: 'HTML occurrences' }).locator('dd'),
  ).toHaveText('4');
  await expect(detail.getByText('Partial coverage', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(
    page.getByRole('cell', { name: 'Empty alt (possibly decorative)', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Filter inventory').selectOption('missing');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Filter inventory').selectOption('oversized');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('600,000 B');
  await page.getByLabel('Filter inventory').selectOption('failed');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('HTTP 404');

  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = await csvEvent;
  const csvText = await readFile((await csv.path())!, 'utf8');
  expect(csvText).toContain('"\'=SUM(1,2)"');
  expect(csvText.split('\r\n')).toHaveLength(7); // header + all five rows + final newline
  const jsonEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const json = await jsonEvent;
  const exported = JSON.parse(await readFile((await json.path())!, 'utf8')) as {
    resources: unknown[];
  };
  expect(exported.resources).toHaveLength(3);
  expect(previewRequests).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
    })),
  ).toEqual({ local: 0, session: 0, cookie: '' });

  await page.getByLabel('Filter inventory').selectOption('all');
  await page.screenshot({ path: info.outputPath('results-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Webpage URL')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroll = page.getByRole('region', { name: 'Scrollable image inventory' });
  await scroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await scroll.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({ path: info.outputPath('results-mobile.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
});

test('invalid token, form validation, empty results and retryable API errors', async ({ page }) => {
  let invalid = true;
  let detailError = true;
  let posts = 0;
  await page.route('**/api/audits**', async (route) => {
    const url = new URL(route.request().url());
    if (invalid) return respond(route, { error: { message: 'Unauthorized' } }, 401);
    if (route.request().method() === 'POST') {
      posts++;
      return respond(route, { error: { message: 'Host not approved' } }, 400);
    }
    if (['/images', '/documents', '/issues'].some((p) => url.pathname.endsWith(p)))
      return respond(route, {
        attempt: 1,
        items: [],
        total: 0,
        page: { nextCursor: null, hasMore: false },
      });
    if (url.pathname.endsWith(first)) {
      if (detailError) return respond(route, { error: { message: 'Temporary failure' } }, 503);
      return respond(route, job(first));
    }
    return respond(route, { items: [job(first)], page: { nextCursor: null, hasMore: false } });
  });
  await page.goto('/');
  await page.getByLabel('Local demo token').fill('invalid');
  await page.getByLabel('Local demo token').press('Tab');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Token not accepted');
  invalid = false;
  await page.getByLabel('Local demo token').press('Tab');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('Webpage URL').fill('https://user:password@example.com/');
  await page.getByRole('button', { name: 'Start audit' }).click();
  await expect(page.getByRole('alert')).toContainText('without embedded credentials');
  expect(posts).toBe(0);
  await page.getByLabel('Webpage URL').fill('https://unapproved.invalid');
  await page.getByRole('button', { name: 'Start audit' }).click();
  await expect(page.getByRole('alert')).toContainText('Host not approved');
  await page.getByRole('button', { name: new RegExp(first) }).click();
  await expect(page.getByRole('button', { name: 'Retry details' })).toBeVisible();
  detailError = false;
  await page.getByRole('button', { name: 'Retry details' }).click();
  await expect(
    page.getByText('No image occurrences found in the inspected documents.'),
  ).toBeVisible();
  await page.getByLabel('Filter inventory').selectOption('missing');
  await expect(
    page.getByText('No image occurrences found in the inspected documents.'),
  ).toBeVisible();
});

test('polls active jobs only and stops after completion and disconnect', async ({ page }) => {
  let state: AuditJob['state'] = 'running';
  let calls = 0;
  let details = 0;
  await page.route('**/api/audits**', async (route) => {
    calls++;
    const path = new URL(route.request().url()).pathname;
    if (['/images', '/documents', '/issues'].some((p) => path.endsWith(p)))
      return respond(route, {
        attempt: 1,
        items: [],
        total: 0,
        page: { nextCursor: null, hasMore: false },
      });
    if (path.endsWith(first)) {
      details++;
      return respond(route, job(first, state));
    }
    return respond(route, {
      items: [job(first, state)],
      page: { nextCursor: null, hasMore: false },
    });
  });
  await connect(page);
  await page.getByRole('button', { name: new RegExp(first) }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect.poll(() => details).toBeGreaterThan(1);
  state = 'completed';
  await expect(
    page.getByText('No image occurrences found in the inspected documents.'),
  ).toBeVisible();
  await expect(page.locator('.recent .badge')).toHaveText('completed');
  const finished = calls;
  await page.waitForTimeout(1800);
  expect(calls).toBe(finished);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
  await page.waitForTimeout(1800);
  expect(calls).toBe(finished);
});

test('switching audits discards a late response; closing detail cancels polling', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let slowStarted = false;
  let secondCalls = 0;
  await page.route('**/api/audits**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(first)) {
      slowStarted = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return respond(route, job(first)).catch(() => {});
    }
    if (path.endsWith(second)) {
      secondCalls++;
      return respond(route, job(second, 'running'));
    }
    return respond(route, {
      items: [job(first), job(second)],
      page: { nextCursor: null, hasMore: false },
    });
  });
  await connect(page);
  await page.getByRole('button', { name: new RegExp(first) }).click();
  await expect.poll(() => slowStarted).toBe(true);
  await page.getByRole('button', { name: new RegExp(second) }).click();
  await expect(page.locator('.detail-url')).toContainText(second);
  release!();
  await page.waitForTimeout(200);
  await expect(page.locator('.detail-url')).toContainText(second);
  await page.getByRole('button', { name: 'Close detail' }).click();
  const closed = secondCalls;
  await page.waitForTimeout(1800);
  expect(secondCalls).toBe(closed);
  await expect(page.getByRole('heading', { name: 'Your findings, in focus' })).toBeVisible();
});

test('uncertain submission retries reuse the idempotency key and failed jobs stop polling', async ({
  page,
}) => {
  const keys: Array<string | undefined> = [];
  let reads = 0;
  await page.route('**/api/audits**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) return route.abort();
      return respond(route, { id: first }, 202);
    }
    if (path.endsWith(first)) {
      reads++;
      return respond(route, {
        ...job(first, 'failed'),
        lastError: { code: 'http', message: 'Page unavailable', retryable: false, at: Date.now() },
      });
    }
    return respond(route, { items: [], page: { nextCursor: null, hasMore: false } });
  });
  await connect(page);
  await expect(page.getByText('No audits yet. Submit your first page above.')).toBeVisible();
  await page.getByLabel('Webpage URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Start audit' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not reach');
  await page.getByRole('button', { name: 'Start audit' }).click();
  await expect(page.getByText('Audit failed: Page unavailable')).toBeVisible();
  await expect(page.getByText('No image results are available for this audit.')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const stopped = reads;
  await page.waitForTimeout(1800);
  expect(reads).toBe(stopped);
});

test('disconnect during active polling clears private content and stops requests', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/audits**', async (route) => {
    calls++;
    const path = new URL(route.request().url()).pathname;
    return respond(
      route,
      path.endsWith(first)
        ? job(first, 'running')
        : { items: [job(first, 'running')], page: { nextCursor: null, hasMore: false } },
    );
  });
  await connect(page);
  await page.getByRole('button', { name: new RegExp(first) }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  const stopped = calls;
  await page.waitForTimeout(1800);
  expect(calls).toBe(stopped);
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
  await expect(page.getByText('https://example.com/' + first, { exact: true })).toHaveCount(0);
});

test('rendered crawl form reaches worker and exposes document provenance', async ({
  page,
}, info) => {
  await connect(page);
  await page.getByLabel('Webpage URL').fill('http://127.0.0.1:3102/render-root');
  await page.getByLabel('Scan mode').selectOption('crawl');
  await page.getByLabel('Inspect iframe documents').check();
  await page.getByLabel('Maximum pages').fill('2');
  await page.getByLabel('Maximum link depth').fill('1');
  await page.getByRole('button', { name: 'Start audit' }).click();
  await expect(page.getByRole('heading', { name: 'Image inventory' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('.metrics div').filter({ hasText: 'Unique resources' }).locator('dd'),
  ).toHaveText('1');
  await expect(
    page.locator('.metrics div').filter({ hasText: 'HTML occurrences' }).locator('dd'),
  ).toHaveText('3');
  await expect(page.locator('tbody')).toContainText('Dynamic image');
  await expect(page.locator('tbody')).toContainText('/render-frame');
  await page.getByText('3 documents · crawl scan', { exact: true }).click();
  await expect(page.locator('.detail details')).toContainText('/render-child');
  await page.screenshot({ path: info.outputPath('rendered-crawl.png'), fullPage: true });
});

test('recent audit pages navigate both ways and detail separates document and image progress', async ({
  page,
}) => {
  const next = 'opaque-next';
  await page.route('**/api/audits?*', async (route) => {
    const older = new URL(route.request().url()).searchParams.has('cursor');
    await respond(route, {
      items: [job(older ? second : first)],
      page: { nextCursor: older ? null : next, hasMore: !older },
    });
  });
  const running = job(second, 'running');
  running.progress = {
    phase: 'rendering-document',
    documentsVisited: 2,
    documentsScheduled: 4,
    inspected: 0,
    total: null,
  };
  await page.route('**/api/audits/' + second, (route) => respond(route, running));
  await connect(page);
  const list = page.locator('.job-list');
  await expect(list).toContainText(first);
  await page.getByRole('button', { name: 'Older audits', exact: true }).click();
  await expect(list).toContainText(second);
  await expect(list).not.toContainText(first);
  await expect(page.getByRole('button', { name: 'Older audits', exact: true })).toBeDisabled();
  await list.getByRole('button').click();
  await expect(page.locator('.progress-status')).toContainText(
    'rendering document · 2 documents visited · 0 images inspected',
  );
  await page.getByRole('button', { name: 'Newer audits', exact: true }).click();
  await expect(list).toContainText(first);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
});

test('inventory uses database pages and resets the cursor when the filter changes', async ({
  page,
}) => {
  const makeRow = (i: number) => ({
    key: 'o' + i,
    occurrence: { id: 'o' + i, alt: { state: 'missing' }, candidates: [] },
    candidate: { rawUrl: '/image-' + i, element: 'img', attribute: 'src', role: 'fallback' },
    issues: [],
  });
  const cursor = 'opaque-images';
  const queries: Array<URL> = [];
  await page.route('**/api/audits**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/images')) {
      queries.push(url);
      const supplied = url.searchParams.get('cursor');
      if (url.searchParams.get('filter') === 'missing_alt') {
        expect(supplied).toBeNull();
        return respond(route, {
          attempt: 1,
          items: [makeRow(24)],
          total: 1,
          page: { nextCursor: null, hasMore: false },
        });
      }
      const older = supplied === cursor;
      return respond(route, {
        attempt: 1,
        items: Array.from({ length: older ? 5 : 20 }, (_, i) => makeRow((older ? 20 : 0) + i)),
        total: 25,
        page: { nextCursor: older ? null : cursor, hasMore: !older },
      });
    }
    if (['/documents', '/issues'].some((p) => url.pathname.endsWith(p)))
      return respond(route, { attempt: 1, items: [], page: { nextCursor: null, hasMore: false } });
    if (url.pathname.endsWith('/' + first)) {
      const value = job(first);
      value.publishedResult!.summary = {
        ...value.publishedResult!.summary,
        htmlOccurrences: 25,
        candidates: 25,
        missingAlt: 1,
      };
      return respond(route, value);
    }
    return respond(route, { items: [job(first)], page: { nextCursor: null, hasMore: false } });
  });
  await connect(page);
  await page.locator('.job-list button').click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: 'Next images', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.locator('tbody')).toContainText('o24');
  await page.getByLabel('Filter inventory').selectOption('missing');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Previous images', exact: true })).toBeDisabled();
  expect(queries.length).toBeGreaterThanOrEqual(3);
});
