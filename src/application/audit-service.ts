import type { Authenticator } from './auth.js';
import { JobError } from './jobs.js';
import type { JobStore } from './jobs.js';
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
      || Object.keys(input).length !== 1 || !('url' in input)
      || typeof input.url !== 'string' || input.url.length < 1 || input.url.length > 2048) {
      throw new JobError(400, 'invalid_request', 'Expected a URL-only payload');
    }
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))) {
      throw new JobError(400, 'invalid_idempotency_key', 'Invalid Idempotency-Key');
    }
    let url: string;
    try { url = this.policy(input.url).href; }
    catch (error) { throw new JobError(400, 'invalid_target', error instanceof Error ? error.message : 'Invalid URL'); }
    return this.store.create(url, key as string | undefined, userId);
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
  list(authorization: unknown, limit = 20) {
    const userId = this.auth.authenticate(authorization);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new JobError(400, 'invalid_request', 'Limit must be 1–100');
    return this.store.list(limit, userId);
  }
}
