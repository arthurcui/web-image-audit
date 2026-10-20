import { loadBuffer } from 'cheerio';
import { discover } from './discover.js';
import { createFetcher } from './fetch.js';
import { renderDocument, renderFailure } from './render.js';
import { createUrlPolicy } from './policy.js';
import { parseScan } from '../../shared/scan.js';
import type { AuditOptions, AuditResult, FetchResult, Limits } from './types.js';

type Task = { url: string; kind: 'page' | 'iframe'; depth: number; frameDepth: number; parentUrl?: string; inline?: string };
export function publicMetadata(value: FetchResult): FetchResult {
  const { url, state, bytes, bytesComplete, attempts, code, message, status, contentType, retryAfterMs } = value;
  return { url, state, bytes, bytesComplete, attempts, ...(code ? { code } : {}), ...(message ? { message } : {}),
    ...(status === undefined ? {} : { status }), ...(contentType ? { contentType } : {}), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

/** Bounded breadth-first discovery, sharing a global image inventory across documents. */
export async function collectDocuments(pageUrl: string, options: AuditOptions, limits: Limits): Promise<{ result: AuditResult; reasons: Set<string> }> {
  const scan = parseScan(options.scan);
  const policy = createUrlPolicy(options.approvedHosts);

  const initial: FetchResult = { url: pageUrl, state: 'failed', bytes: 0, bytesComplete: false, attempts: 0 };
  const result: AuditResult = { page: initial, scan, documents: [], occurrences: [], resources: [], issues: [], coverage: { complete: false, reasons: [] } };
  const reasons = new Set<string>();
  const queue: Task[] = [{ url: pageUrl, kind: 'page', depth: 0, frameDepth: 0 }];
  const scheduled = new Set([pageUrl]);
  const visited = new Set<string>();
  let origin = '';
  let pages = 1;
  let frames = 0;
  let candidates = 0;
  const started = Date.now();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (Date.now() - started > 120_000) { reasons.add('Document discovery deadline reached'); break; }
    const task = queue[cursor]!;
    const fetchPage = createFetcher((input, base) => {
      const target = policy(input, base);
      if (cursor > 0 && task.kind === 'page' && target.origin !== origin) throw new Error('Crawl document left starting origin');
      return target;
    }, limits);
    const page = task.inline === undefined ? await fetchPage(task.url, true) : { ...initial, url: task.url, state: 'ok' as const, bytes: Buffer.byteLength(task.inline), bytesComplete: true, body: Buffer.from(task.inline), charset: 'utf-8' };
    if (cursor === 0) { result.page = publicMetadata(page); if (page.state === 'ok') origin = new URL(page.url).origin; }
    const id = 'document-' + cursor;
    result.documents!.push({ id, url: page.url, kind: task.kind, depth: task.depth, ...(task.parentUrl ? { parentUrl: task.parentUrl } : {}), state: page.state });
    if (page.state !== 'ok' || !page.body) { reasons.add('Document could not be inspected: ' + task.url + ' (' + (page.code ?? page.state) + ')'); continue; }
    if (task.kind === 'page' && cursor > 0 && new URL(page.url).origin !== origin) {
      reasons.add('Crawl redirect left starting origin: ' + page.url); continue;
    }
    if (task.inline === undefined && visited.has(page.url)) continue;
    if (task.inline === undefined) visited.add(page.url);
    let body = page.body;
    delete page.body;
    if (scan.mode !== 'static') {
      try {
        // Decode legacy HTML encodings before Chromium receives a UTF-8 document.
        body = Buffer.from(loadBuffer(body, page.charset ? { encoding: { transportLayerEncodingLabel: page.charset } } : {}).html());
        const rendered = await renderDocument(body, page.url, policy, limits);
        body = rendered.body;
        for (const reason of rendered.reasons) reasons.add(reason);
      } catch (error) {
        const failure = renderFailure(error, 'snapshot');
        reasons.add('Browser rendering failed: ' + page.url + '. ' + failure.message);
        result.documents!.at(-1)!.state = 'failed';
        if (cursor === 0) result.page = { ...result.page, state: 'failed', code: failure.code, message: failure.message };
        continue;
      }
    }
    const parsed = discover(body, page.url, { ...limits, maxOccurrences: Math.max(0, limits.maxOccurrences - result.occurrences.length), maxCandidates: Math.max(0, limits.maxCandidates - candidates) }, scan.mode === 'static' ? page.charset : 'utf-8');
    if (cursor === 0) result.baseUrl = parsed.baseUrl;
    for (const reason of parsed.reasons) reasons.add(reason);
    for (const occurrence of parsed.occurrences) {
      occurrence.id = 'occurrence-' + result.occurrences.length;
      occurrence.documentId = id;
      occurrence.documentUrl = page.url;
      for (const candidate of occurrence.candidates) {
        candidates++;
        if (!candidate.skipped) {
          try { candidate.url = policy(candidate.rawUrl, parsed.baseUrl).href; }
          catch (error) { candidate.skipped = error instanceof Error ? error.message : 'URL rejected'; }
        }
      }
      result.occurrences.push(occurrence);
    }
    const $ = loadBuffer(body, scan.mode === 'static' && page.charset ? { encoding: { transportLayerEncodingLabel: page.charset } } : {});
    function enqueue(raw: string, kind: Task['kind']) {
      let url: URL;
      try { url = policy(raw, parsed.baseUrl); }
      catch { reasons.add('Linked document rejected by URL policy'); return; }
      if (kind === 'page' && url.origin !== origin) return;
      if (scheduled.has(url.href) || visited.has(url.href)) return;
      if (kind === 'page' && (task.depth >= scan.maxDepth || pages >= scan.maxPages)) { reasons.add('Crawl page or depth limit reached'); return; }
      if (kind === 'iframe' && (task.frameDepth >= 2 || frames >= 10)) { reasons.add('Iframe document or depth limit reached'); return; }
      scheduled.add(url.href);
      if (kind === 'page') pages++; else frames++;
      queue.push({ url: url.href, kind, depth: task.depth + (kind === 'page' ? 1 : 0), frameDepth: kind === 'iframe' ? task.frameDepth + 1 : 0, parentUrl: page.url });
    }
    if (scan.includeIframes) {
      $('iframe,frame').each((_i, element) => {
        const inline = $(element).attr('srcdoc');
        if (inline !== undefined) {
          if (task.frameDepth >= 2 || frames >= 10 || Buffer.byteLength(inline) > limits.maxPageBytes) { reasons.add('Inline iframe document, depth or byte limit reached'); return; }
          frames++;
          queue.push({ url: parsed.baseUrl, inline, kind: 'iframe', depth: task.depth, frameDepth: task.frameDepth + 1, parentUrl: page.url });
          return;
        }
        const src = $(element).attr('src');
        if (src) enqueue(src, 'iframe');
      });
    } else if ($('iframe,frame').length) reasons.add('Iframe documents excluded by scan options');
    if (scan.mode === 'crawl' && task.kind === 'page') $('a[href]').each((_i, element) => { enqueue($(element).attr('href')!, 'page'); });
  }
  return { result, reasons };
}
