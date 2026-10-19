import { discover } from './discover.js';
import { createFetcher } from './fetch.js';
import { createUrlPolicy } from './policy.js';
import { defaults } from './types.js';
import type { AuditOptions, AuditResult, FetchResult, Limits, Resource } from './types.js';
export type { AuditOptions, AuditResult, Candidate, Occurrence, Resource, FetchResult } from './types.js';
export { createUrlPolicy } from './policy.js';

function getLimits(options: AuditOptions): Limits {
  const limits = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof Limits>) {
    const value = options[key] ?? defaults[key];
    const minimum = ['maxRetries', 'maxRedirects', 'retryBaseMs', 'maxRetryDelayMs'].includes(key) ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647) {
      throw new RangeError(key + ' must be a bounded integer >= ' + minimum);
    }
    Object.assign(limits, { [key]: value });
  }
  // Configuration mistakes must not create unbounded work or exponential overflow.
  if (limits.concurrency > 64 || limits.maxRetries > 5 || limits.maxRedirects > 20) {
    throw new RangeError('concurrency <= 64, maxRetries <= 5, maxRedirects <= 20 required');
  }
  return limits;
}

function metadata(result: FetchResult): FetchResult {
  // Deliberately exclude body and private transport bookkeeping from public results.
  const { url, state, bytes, bytesComplete, attempts, code, message, status, contentType, retryAfterMs } = result;
  return { url, state, bytes, bytesComplete, attempts,
    ...(code === undefined ? {} : { code }), ...(message === undefined ? {} : { message }),
    ...(status === undefined ? {} : { status }), ...(contentType === undefined ? {} : { contentType }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

/** Fetch exactly one document and inspect its static image candidates; never crawl links. */
export async function auditPage(pageUrl: string, options: AuditOptions): Promise<AuditResult> {
  const limits = getLimits(options);
  const policy = createUrlPolicy(options.approvedHosts);
  const fetchResource = createFetcher(policy, limits);
  const page = await fetchResource(pageUrl, true);
  const result: AuditResult = {
    page: metadata(page), occurrences: [], resources: [], issues: [],
    coverage: { complete: false, reasons: [] },
  };
  if (page.state !== 'ok' || !page.body) {
    result.coverage.reasons.push('Page could not be inspected: ' + (page.code ?? page.state));
    return result;
  }
  const { occurrences, baseUrl, reasons } = discover(page.body, page.url, limits, page.charset);
  delete page.body;
  result.occurrences = occurrences;
  result.baseUrl = baseUrl;
  const resources = new Map<string, Resource>();
  for (const occurrence of occurrences) {
    if (occurrence.alt.state === 'missing') {
      result.issues.push({ code: 'missing-alt', occurrenceId: occurrence.id,
        message: 'Alt attribute is absent; review the image purpose and text alternative.' });
    }
    for (const candidate of occurrence.candidates) {
      if (!candidate.skipped) {
        try { candidate.url = policy(candidate.rawUrl, baseUrl).href; }
        catch (error) { candidate.skipped = error instanceof Error ? error.message : 'URL rejected'; }
      }
      if (candidate.url && !candidate.skipped) {
        let resource = resources.get(candidate.url);
        if (!resource) {
          if (resources.size >= limits.maxImages) {
            candidate.skipped = 'Unique image resource limit reached';
          } else {
            resource = { id: 'resource-' + resources.size, requestedUrl: candidate.url,
              url: candidate.url, state: 'skipped', bytes: 0, bytesComplete: false, attempts: 0, oversized: false };
            resources.set(candidate.url, resource);
          }
        }
        if (resource) candidate.resourceId = resource.id;
      }
      if (candidate.skipped) {
        reasons.add(candidate.skipped);
        result.issues.push({ code: 'skipped-url', occurrenceId: occurrence.id, message: candidate.skipped });
      }
    }
  }
  result.resources = [...resources.values()];
  let next = 0;
  async function worker() {
    while (next < result.resources.length) {
      const resource = result.resources[next++]!;
      const inspected = await fetchResource(resource.requestedUrl);
      Object.assign(resource, metadata(inspected), { oversized: inspected.bytes > limits.oversizedBytes });
    }
  }
  await Promise.all(Array.from({ length: Math.min(limits.concurrency, resources.size) }, worker));
  // Stable issue ordering independent of completion order.
  for (const resource of result.resources) {
    if (resource.state !== 'ok') {
      reasons.add('Resource inspection incomplete: ' + (resource.code ?? resource.state));
      result.issues.push({ code: resource.code ?? resource.state, resourceId: resource.id,
        message: resource.message ?? 'Resource could not be inspected' });
    }
    if (resource.oversized) result.issues.push({
      code: 'oversized-image', resourceId: resource.id,
      message: 'Consumed image bytes exceed the configured threshold',
    });
  }
  result.coverage = { complete: reasons.size === 0, reasons: [...reasons] };
  return result;
}
