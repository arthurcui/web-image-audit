import { parseScan } from '../shared/scan.js';
import type { Authenticator } from './auth.js';
import { JobError } from './jobs.js';
import type { JobCursor, JobStore } from './jobs.js';
import { createUrlPolicy } from './audit/policy.js';

/** Public application boundary. API/MCP must use this, not the trusted worker repository. */
export class AuditService {
  private readonly policy: ReturnType<typeof createUrlPolicy>;
  constructor(private readonly store: JobStore, private readonly auth: Authenticator, approvedHosts: readonly string[]) {
    this.policy = createUrlPolicy(approvedHosts);
  }
  create(authorization: unknown, input: unknown, key?: unknown) {
    const userId = this.auth.authenticate(authorization);
    if (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).some(k => !['url', 'scan'].includes(k)) || !('url' in input)
      || typeof input.url !== 'string' || input.url.length < 1 || input.url.length > 2048) {
      throw new JobError(400, 'invalid_request', 'Expected a URL and optional scan options');
    }
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))) {
      throw new JobError(400, 'invalid_idempotency_key', 'Invalid Idempotency-Key');
    }
    let url: string;
    try { url = this.policy(input.url).href; }
    catch (error) { throw new JobError(400, 'invalid_target', error instanceof Error ? error.message : 'Invalid URL'); }
    let scan;
    try { scan = parseScan('scan' in input ? input.scan : undefined); }
    catch { throw new JobError(400, 'invalid_request', 'Invalid scan options'); }
    return this.store.create(url, key as string | undefined, userId, scan);
  }
  get(authorization: unknown, id: string) {
    const userId = this.auth.authenticate(authorization);
    const job = this.store.get(id, userId);
    if (!job) throw new JobError(404, 'job_not_found', 'Audit job not found');
    return job;
  }
  results(authorization: unknown, id: string) {
    const userId = this.auth.authenticate(authorization);
    const result = this.store.results(id, userId);
    if (!result) throw new JobError(404, 'job_not_found', 'Audit job not found');
    return result;
  }
  list(authorization: unknown, limit = 20, before?: JobCursor) {
    const userId = this.auth.authenticate(authorization);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new JobError(400, 'invalid_request', 'Limit must be 1–100');
    if (before && (!Number.isSafeInteger(before.createdAt) || before.createdAt < 0 || !/^[0-9a-f-]{36}$/.test(before.id))) {
      throw new JobError(400, 'invalid_request', 'Invalid pagination cursor');
    }
    return this.store.list(limit, userId, before);
  }
}
