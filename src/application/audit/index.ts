// Run document discovery and resource inspection to assemble an audit result.
import { toFetchMetadata } from './metadata.js';
import { collectDocuments } from './documents.js';
import { createFetcher } from './adapters/http-fetcher.js';
import { createUrlPolicy } from './policy.js';
import { defaultAuditLimits } from './types.js';
import type { AuditOptions, Limits, DocumentProgress } from './types.js';
import type { AuditResult, Resource } from '../../shared/audit.js';
export type { AuditOptions } from './types.js';
export type {
  AuditResult,
  Candidate,
  Occurrence,
  Resource,
  FetchResult,
} from '../../shared/audit.js';
export { createUrlPolicy } from './policy.js';

function getLimits(options: AuditOptions): Limits {
  const limits = { ...defaultAuditLimits };
  for (const key of Object.keys(defaultAuditLimits) as Array<keyof Limits>) {
    const value = options[key] ?? defaultAuditLimits[key];
    const minimum = ['maxRetries', 'maxRedirects', 'retryBaseMs', 'maxRetryDelayMs'].includes(key)
      ? 0
      : 1;
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

/** Inspect a bounded set of static or rendered documents and deduplicate image resources globally. */
export async function runAudit(
  pageUrl: string,
  options: AuditOptions,
  hooks: {
    onDocumentProgress?: (progress: DocumentProgress) => void;
    onProgress?: (progress: { inspected: number; total: number }) => void;
  } = {},
): Promise<AuditResult> {
  const limits = getLimits(options);
  const policy = createUrlPolicy(options.approvedHosts);
  const fetchResource = createFetcher(policy, limits);
  const { result, findings } = await collectDocuments(
    pageUrl,
    options,
    limits,
    hooks.onDocumentProgress,
  );
  const occurrences = result.occurrences;
  const resources = new Map<string, Resource>();
  for (const occurrence of occurrences) {
    if (occurrence.alt.state === 'missing') {
      result.issues.push({
        code: 'missing-alt',
        occurrenceId: occurrence.id,
        message: 'Alt attribute is absent; review the image purpose and text alternative.',
      });
    }
    for (const candidate of occurrence.candidates) {
      let skipCode: 'candidate-skipped' | 'resource-limit' = 'candidate-skipped';
      if (!candidate.skipped) {
        try {
          candidate.url = policy(candidate.url ?? candidate.rawUrl, result.baseUrl).href;
        } catch (error) {
          candidate.skipped = error instanceof Error ? error.message : 'URL rejected';
        }
      }
      if (candidate.url && !candidate.skipped) {
        let resource = resources.get(candidate.url);
        if (!resource) {
          if (resources.size >= limits.maxUniqueResources) {
            candidate.skipped = 'Unique image resource limit reached';
            skipCode = 'resource-limit';
          } else {
            resource = {
              id: 'resource-' + resources.size,
              requestedUrl: candidate.url,
              url: candidate.url,
              state: 'skipped',
              bytes: 0,
              bytesComplete: false,
              attempts: 0,
              oversized: false,
            };
            resources.set(candidate.url, resource);
          }
        }
        if (resource) candidate.resourceId = resource.id;
      }
      if (candidate.skipped) {
        findings.add(skipCode, candidate.skipped);
        result.issues.push({
          code: 'skipped-url',
          occurrenceId: occurrence.id,
          message: candidate.skipped,
        });
      }
    }
  }
  result.resources = [...resources.values()];
  let inspectedCount = 0;
  hooks.onProgress?.({ inspected: 0, total: result.resources.length });
  let next = 0;
  async function worker() {
    while (next < result.resources.length) {
      const resource = result.resources[next++]!;
      const inspected = await fetchResource(resource.requestedUrl);
      Object.assign(resource, toFetchMetadata(inspected), {
        oversized: inspected.bytes > limits.oversizedBytes,
      });
      hooks.onProgress?.({ inspected: ++inspectedCount, total: result.resources.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(limits.concurrency, resources.size) }, worker));
  // Stable issue ordering independent of completion order.
  for (const resource of result.resources) {
    if (resource.state !== 'ok') {
      findings.add(
        'resource-incomplete',
        'Resource inspection incomplete: ' + (resource.code ?? resource.state),
      );
      result.issues.push({
        code: resource.code ?? resource.state,
        resourceId: resource.id,
        message: resource.message ?? 'Resource could not be inspected',
      });
    }
    if (resource.oversized)
      result.issues.push({
        code: 'oversized-image',
        resourceId: resource.id,
        message: 'Consumed image bytes exceed the configured threshold',
      });
  }
  result.coverage = { complete: findings.size === 0, findings: [...findings] };
  return result;
}
