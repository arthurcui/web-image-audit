import {
  createAuditSchema,
  idempotencyKeySchema,
  listAuditsSchema,
  auditIdSchema,
} from '../shared/inputs.js';
import { toPublicJob } from './job-view.js';
import { defaultScan } from '../shared/scan.js';
import type { Authenticator } from './auth.js';
import { JobError } from './jobs.js';
import type { JobCursor, AuditRepository } from './jobs.js';
import { createUrlPolicy } from './audit/policy.js';

/** Public application boundary. API/MCP must use this, not the trusted worker repository. */
export class AuditService {
  private readonly policy: ReturnType<typeof createUrlPolicy>;
  constructor(
    private readonly store: AuditRepository,
    private readonly auth: Authenticator,
    approvedHosts: readonly string[],
  ) {
    this.policy = createUrlPolicy(approvedHosts);
  }
  create(authorization: unknown, input: unknown, key?: unknown) {
    const userId = this.auth.authenticate(authorization);
    const parsed = createAuditSchema.safeParse(input);
    if (!parsed.success)
      throw new JobError('invalid_request', 'Expected an HTTP/HTTPS URL and valid scan options');
    const parsedKey = idempotencyKeySchema.optional().safeParse(key);
    if (!parsedKey.success)
      throw new JobError('invalid_idempotency_key', 'Invalid Idempotency-Key');
    let url: string;
    try {
      url = this.policy(parsed.data.url).href;
    } catch (error) {
      throw new JobError('invalid_target', error instanceof Error ? error.message : 'Invalid URL');
    }
    const scan = parsed.data.scan ?? { ...defaultScan };
    const created = this.store.create(url, parsedKey.data, userId, scan);
    return { job: toPublicJob(created.job), replayed: created.replayed };
  }
  get(authorization: unknown, id: string) {
    const userId = this.auth.authenticate(authorization);
    if (!auditIdSchema.safeParse(id).success)
      throw new JobError('invalid_request', 'Invalid audit ID');
    const job = this.store.get(id, userId);
    if (!job) throw new JobError('job_not_found', 'Audit job not found');
    return toPublicJob(job);
  }
  results(authorization: unknown, id: string) {
    const userId = this.auth.authenticate(authorization);
    if (!auditIdSchema.safeParse(id).success)
      throw new JobError('invalid_request', 'Invalid audit ID');
    const result = this.store.results(id, userId);
    if (!result) throw new JobError('job_not_found', 'Audit job not found');
    return { ...result, job: toPublicJob(result.job) };
  }
  list(authorization: unknown, limit = 20, before?: JobCursor) {
    const userId = this.auth.authenticate(authorization);
    const parsed = listAuditsSchema.safeParse({ limit, before });
    if (!parsed.success)
      throw new JobError('invalid_request', 'Invalid limit or pagination cursor');
    return this.store.list(parsed.data.limit, userId, parsed.data.before).map(toPublicJob);
  }
}
