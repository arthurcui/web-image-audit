// Test the browser-to-MCP audit workflow.
import { test, expect } from '@playwright/test';
import { fixtureToken, fixtureUrl } from './fixture.js';

test('scripted chat uses the real MCP bridge from start through status and issue summary', async ({
  page,
}, info) => {
  let bridgeCalls = 0;
  let directCreates = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/mcp-demo')) bridgeCalls++;
    if (req.url().endsWith('/api/audits') && req.method() === 'POST') directCreates++;
  });
  await page.goto('/');
  await page.getByLabel('Local demo token').fill(fixtureToken);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const chat = page.getByRole('region', { name: 'MCP chat', exact: true });
  await expect(chat).toContainText('not an AI model');
  await chat.getByLabel('Chat command').fill('Audit ' + fixtureUrl);
  await chat.getByLabel('Chat command').press('Enter');
  await expect(chat.getByRole('log')).toContainText('Check its status next.');
  await expect
    .poll(
      async () => {
        await chat.getByRole('button', { name: 'Check its status', exact: true }).click();
        await expect(chat.getByRole('button', { name: 'Send command', exact: true })).toBeEnabled();
        return chat.getByRole('log').innerText();
      },
      { timeout: 15_000, intervals: [1500] },
    )
    .toContain('Status: completed');
  await chat.getByRole('button', { name: 'Show the issues', exact: true }).click();
  await expect(chat.getByRole('log')).toContainText('3 unique resources across 4 HTML occurrences');
  await chat
    .getByText('Tool call: get_audit_results · stdio response', { exact: true })
    .last()
    .click();
  await expect(chat.locator('pre').last()).toContainText('missing-alt');
  await chat.getByRole('button', { name: 'List my audits', exact: true }).click();
  await expect(chat.getByRole('log')).toContainText('recent audits');
  expect(bridgeCalls).toBeGreaterThanOrEqual(4);
  expect(directCreates).toBe(0);
  const previous = bridgeCalls;
  await chat.getByLabel('Chat command').fill('Tell me a joke');
  await chat.getByRole('button', { name: 'Send command', exact: true }).click();
  await expect(chat.getByRole('log')).toContainText('Try: audit');
  expect(bridgeCalls).toBe(previous);
  await chat.screenshot({ path: info.outputPath('mcp-chat.png') });
  await chat.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await expect(chat.getByRole('log')).not.toContainText('Current audit');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('region', { name: 'MCP chat', exact: true })).toHaveCount(0);
});

test('chat retries retain the exact idempotency key and disconnect ignores late responses', async ({
  page,
}) => {
  const calls: Array<{ name: string; arguments: { idempotencyKey: string } }> = [];
  await page.route('**/api/audits/mcp-demo', async (route) => {
    calls.push(route.request().postDataJSON());
    if (calls.length === 1) return route.abort();
    return route.fulfill({
      json: {
        transport: 'stdio',
        tool: 'start_audit',
        result: {
          structuredContent: {
            ok: true,
            data: { id: '11111111-1111-4111-8111-111111111111', state: 'queued' },
            error: null,
          },
        },
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Local demo token').fill(fixtureToken);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Chat command').fill('Audit https://example.com/');
  await page.getByRole('button', { name: 'Send command' }).click();
  await page.getByRole('button', { name: 'Retry command' }).click();
  await expect(page.getByRole('log')).toContainText('Check its status next.');
  expect(calls).toHaveLength(2);
  expect(calls[0]!.arguments.idempotencyKey).toBe(calls[1]!.arguments.idempotencyKey);
  await page.unroute('**/api/audits/mcp-demo');
  let release!: () => void;
  let started = false;
  await page.route('**/api/audits/mcp-demo', async (route) => {
    started = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        json: {
          transport: 'stdio',
          tool: 'list_audits',
          result: {
            structuredContent: { ok: true, data: { jobs: [] }, error: null },
          },
        },
      })
      .catch(() => {});
  });
  await page.getByRole('button', { name: 'List my audits', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  release();
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
  await expect(page.getByRole('log')).toHaveCount(0);
});
