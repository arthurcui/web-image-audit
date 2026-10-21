import { CoverageFindings } from '../coverage.js';
import { browserExecutable } from './browser-config.js';
import { chromium } from 'playwright';
import { createFetcher } from './http-fetcher.js';
import type { UrlPolicy } from '../policy.js';
import type { Limits } from '../types.js';

export class RenderError extends Error {
  constructor(
    public readonly code:
      | 'browser-missing'
      | 'browser-launch'
      | 'render-timeout'
      | 'render-navigation'
      | 'dom-limit'
      | 'render',
    message: string,
  ) {
    super(message);
  }
}

/** Safe, actionable messages; never expose raw browser diagnostics or webpage text. */
export function renderFailure(
  error: unknown,
  phase: 'launch' | 'navigation' | 'snapshot',
  deadlineExpired = false,
): RenderError {
  if (error instanceof RenderError) return error;
  const message = error instanceof Error ? error.message : '';
  if (phase === 'launch' && /Executable doesn't exist|executable.*does not exist/i.test(message)) {
    return new RenderError(
      'browser-missing',
      'Chromium was not found by the worker. Run npm run browser:install in the worker terminal, or set AUDIT_BROWSER_EXECUTABLE to an installed Chromium executable, then restart the worker.',
    );
  }
  if (phase === 'launch')
    return new RenderError(
      'browser-launch',
      'Chromium could not start. Check AUDIT_BROWSER_EXECUTABLE and run the worker from a terminal permitted to launch browsers.',
    );
  if (deadlineExpired || (error instanceof Error && error.name === 'TimeoutError'))
    return new RenderError(
      'render-timeout',
      'Browser rendering exceeded its deadline. The page or its scripts did not become ready in time.',
    );
  if (phase === 'navigation')
    return new RenderError(
      'render-navigation',
      'Browser navigation failed or the document closed before it could be inspected.',
    );
  return new RenderError(
    'render',
    'Could not capture the rendered document. The page may have navigated or the browser closed.',
  );
}

/** Browser traffic is fulfilled through our credential-free, bounded fetcher, never route.continue(). */
export async function renderDocument(body: Buffer, url: string, policy: UrlPolicy, limits: Limits) {
  const findings = new CoverageFindings();
  findings.add(
    'render-snapshot',
    'Rendered DOM is a timed snapshot; interactions, infinite scroll, shadow DOM and image-load-dependent scripts may be missed.',
  );
  let browser;
  try {
    const executablePath = browserExecutable();
    browser = await chromium.launch({
      headless: true,
      timeout: 10_000,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-background-networking',
      ],
    });
  } catch (error) {
    throw renderFailure(error, 'launch');
  }
  let phase: 'launch' | 'navigation' | 'snapshot' = 'launch';
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let deadlineExpired = false;
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      viewport: { width: 1280, height: 900 },
    });
    const fetchAsset = createFetcher(policy, limits);
    let requests = 0;
    let inFlight = 0;
    const page = await context.newPage();
    let delivered = false;
    deadline = setTimeout(() => {
      deadlineExpired = true;
      void context.close().catch(() => {});
    }, 15_000);
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        if (
          !delivered &&
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          request.url() === url
        ) {
          delivered = true;
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            headers: {
              'content-security-policy': "frame-src 'none'; worker-src 'none'; object-src 'none'",
            },
            body,
          });
          return;
        }
        if (request.frame() !== page.mainFrame() || request.resourceType() === 'document') {
          // Iframes are scheduled separately with their own depth/document budgets.
          if (request.frame() === page.mainFrame())
            findings.add('script-navigation-blocked', 'Script navigation blocked');
          await route.abort();
          return;
        }
        if (['image', 'media', 'font'].includes(request.resourceType())) {
          await route.abort();
          return;
        }
        if (
          request.method() !== 'GET' ||
          !['script', 'stylesheet', 'xhr', 'fetch'].includes(request.resourceType())
        ) {
          findings.add('browser-request-blocked', 'Unsupported browser request blocked');
          await route.abort();
          return;
        }
        if (++requests > 50 || inFlight >= limits.concurrency) {
          findings.add(
            'browser-request-limit',
            'Browser request count or concurrency limit reached',
          );
          await route.abort();
          return;
        }
        inFlight++;
        try {
          const asset = await fetchAsset(request.url(), 'asset');
          if (asset.state !== 'ok' || !asset.body) {
            findings.add(
              'browser-dependency-failed',
              'Browser dependency blocked or failed: ' + (asset.code ?? asset.state),
            );
            await route.abort();
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: asset.contentType ?? 'application/octet-stream',
            body: asset.body,
          });
          delete asset.body;
        } finally {
          inFlight--;
        }
      } catch {
        await route.abort().catch(() => {});
      }
    });
    phase = 'navigation';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    // A finite observation window, not an assertion that the page has finished loading.
    await page.waitForTimeout(1000);
    phase = 'snapshot';
    const snapshot = (await page.evaluate(
      `(() => { const html = document.documentElement.outerHTML; return html.length <= ${limits.maxPageBytes} ? html : null; })()`,
    )) as string | null;
    if (snapshot === null || Buffer.byteLength(snapshot) > limits.maxPageBytes)
      throw new RenderError(
        'dom-limit',
        'Rendered document exceeds the configured DOM byte limit. Reduce the page content or use static mode.',
      );
    return { body: Buffer.from(snapshot), findings };
  } catch (error) {
    throw renderFailure(error, phase, deadlineExpired);
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {});
  }
}
