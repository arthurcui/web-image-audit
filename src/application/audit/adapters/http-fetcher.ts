// Fetch approved URLs with bounded redirects, retries, deadlines, and response sizes.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { PolicyError } from '../policy.js';
import type { UrlPolicy } from '../policy.js';
import type { Limits } from '../types.js';
import type { FetchResult } from '../../../shared/audit.js';

export type FetchKind = 'document' | 'image' | 'asset';

interface Hop extends FetchResult {
  body?: Buffer;
  charset?: string;
  location?: string;
  transient?: boolean;
  retryAfterPresent?: boolean;
}
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientNetworkCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
]);

export function parseRetryAfter(value: string, now = Date.now()): number | undefined {
  if (/^\d+$/.test(value.trim())) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  // Do not interpret malformed numeric delays as dates.
  if (!/[a-z]/i.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function requestOnce(url: URL, kind: FetchKind, limits: Limits): Promise<Hop> {
  return new Promise((resolve) => {
    let done = false;
    let bytes = 0;
    const chunks: Buffer[] = []; // Page only. Image chunks are counted and discarded.
    let status: number | undefined;
    let contentType: string | undefined;
    const controller = new AbortController();
    const finish = (result: Partial<Hop> & Pick<Hop, 'state'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        url: url.href,
        bytes,
        bytesComplete: false,
        attempts: 1,
        ...(status === undefined ? {} : { status }),
        ...(contentType === undefined ? {} : { contentType }),
        ...result,
      });
      chunks.length = 0;
      controller.abort();
    };
    const timer = setTimeout(
      () =>
        finish({
          state: 'failed',
          code: 'timeout',
          message: 'Request deadline exceeded',
          transient: true,
        }),
      limits.requestTimeoutMs,
    );
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        signal: controller.signal,
        agent: false,
        maxHeaderSize: 16_384,
        // No caller-provided headers, cookies, authentication or automatic redirects.
        headers: {
          'user-agent': 'WebsiteImageAudit/0.2',
          'accept-encoding': 'identity',
          accept:
            kind === 'asset'
              ? '*/*'
              : kind === 'document'
                ? 'text/html,application/xhtml+xml'
                : 'image/*',
        },
      },
      (response) => {
        status = response.statusCode ?? 0;
        contentType = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        if (redirectStatuses.has(status)) {
          const location = response.headers.location;
          finish(
            location
              ? { state: 'ok', location }
              : { state: 'failed', code: 'invalid-redirect', message: 'Redirect has no Location' },
          );
          return;
        }
        if (status === 206) {
          finish({ state: 'failed', code: 'http', message: 'Unexpected partial response' });
          return;
        }
        if (status < 200 || status >= 300) {
          const retryAfter = response.headers['retry-after'];
          const delay = retryAfter === undefined ? undefined : parseRetryAfter(retryAfter);
          finish({
            state: 'failed',
            code: 'http',
            message: 'HTTP ' + status,
            transient: transientStatuses.has(status),
            retryAfterPresent: retryAfter !== undefined,
            ...(delay === undefined ? {} : { retryAfterMs: delay }),
          });
          return;
        }
        const validType =
          kind === 'asset'
            ? !!contentType
            : kind === 'document'
              ? ['text/html', 'application/xhtml+xml'].includes(contentType)
              : /^image\/[a-z0-9!#$&^_.+-]+$/.test(contentType);
        if (!validType) {
          finish({
            state: 'failed',
            code: 'content-type',
            message: 'Unexpected or missing Content-Type',
          });
          return;
        }
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        ) {
          finish({
            state: 'skipped',
            code: 'encoding',
            message: 'Compressed responses are not supported',
          });
          return;
        }
        const cap = kind !== 'image' ? limits.maxPageBytes : limits.maxImageBytes;
        response.on('data', (chunk: Buffer) => {
          if (done) return;
          bytes += chunk.length;
          if (bytes > cap) {
            finish({
              state: 'failed',
              code: 'byte-limit',
              message: 'Response byte limit exceeded',
            });
          } else if (kind !== 'image') {
            chunks.push(chunk);
          }
        });
        response.on('end', () =>
          finish({
            state: 'ok',
            bytesComplete: true,
            ...(kind !== 'image'
              ? {
                  body: Buffer.concat(chunks),
                  charset:
                    /(?:^|;)\s*charset\s*=\s*["']?([^;\s"']+)/i.exec(
                      response.headers['content-type'] ?? '',
                    )?.[1] ?? '',
                }
              : {}),
          }),
        );
        response.on('error', () =>
          finish({
            state: 'failed',
            code: 'network',
            message: 'Response stream interrupted',
            transient: true,
          }),
        );
      },
    );
    request.on('error', (error: NodeJS.ErrnoException) =>
      finish({
        state: 'failed',
        code: 'network',
        message: error.code ?? 'Network request failed',
        transient: transientNetworkCodes.has(error.code ?? ''),
      }),
    );
    request.end();
  });
}

/** Cache each image hop, including redirects, to coalesce aliases and concurrent requests. */
export function createFetcher(policy: UrlPolicy, limits: Limits) {
  const cache = new Map<string, Promise<Hop>>();
  async function withRetry(url: URL, kind: FetchKind): Promise<Hop> {
    for (let attempt = 0; ; attempt++) {
      const result = await requestOnce(url, kind, limits);
      result.attempts = attempt + 1;
      if (!result.transient || attempt >= limits.maxRetries) return result;
      const backoff = Math.min(
        limits.maxRetryDelayMs,
        limits.retryBaseMs * 2 ** attempt * (0.5 + Math.random()),
      );
      const delay = Math.max(backoff, result.retryAfterMs ?? 0);
      if (
        (result.retryAfterPresent && result.retryAfterMs === undefined) ||
        delay > limits.maxRetryDelayMs
      ) {
        return {
          ...result,
          state: 'deferred',
          code: 'retry-after',
          message: 'Retry-After cannot be honored within the retry budget',
        };
      }
      await sleep(Math.ceil(delay));
    }
  }
  return async (input: string, kind: FetchKind = 'image'): Promise<Hop> => {
    let current = input;
    let attempts = 0;
    const visited = new Set<string>();
    for (let redirects = 0; ; redirects++) {
      let url: URL;
      try {
        url = policy(current);
      } catch (error) {
        return {
          url: current,
          state: 'skipped',
          code: error instanceof PolicyError ? error.code : 'policy',
          message: error instanceof Error ? error.message : 'URL rejected',
          bytes: 0,
          bytesComplete: false,
          attempts,
        };
      }
      if (visited.has(url.href)) {
        return {
          url: url.href,
          state: 'failed',
          code: 'redirect-loop',
          message: 'Redirect cycle detected',
          bytes: 0,
          bytesComplete: false,
          attempts,
        };
      }
      visited.add(url.href);
      let pending = kind !== 'image' ? undefined : cache.get(url.href);
      if (!pending) {
        pending = withRetry(url, kind);
        if (kind === 'image') cache.set(url.href, pending);
      }
      const result = await pending;
      attempts += result.attempts;
      if (!result.location) return { ...result, attempts };
      if (redirects >= limits.maxRedirects) {
        return {
          ...result,
          state: 'failed',
          code: 'redirect-limit',
          message: 'Redirect limit exceeded',
          attempts,
        };
      }
      try {
        current = policy(result.location, url.href).href;
      } catch (error) {
        return {
          url: url.href,
          state: 'skipped',
          code: error instanceof PolicyError ? error.code : 'invalid-redirect',
          message: 'Redirect target rejected: ' + (error instanceof Error ? error.message : ''),
          bytes: 0,
          bytesComplete: false,
          attempts,
        };
      }
    }
  };
}
