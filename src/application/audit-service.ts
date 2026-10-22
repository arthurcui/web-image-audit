/**
 * Shared REST/MCP application boundary: authenticate callers and scope audit access to owners.
 * Transport handlers use this service rather than privileged worker operations; cursor positions
 * never substitute for ownership checks.
 */
import { encodeCursor, decodeCursor } from './cursors.js';
import { pageInputSchema } from '../shared/pagination.js';
import { resultQuerySchema } from '../shared/result-query.js';
import type { ResultQuery, InventoryRow, ResultCursor } from '../shared/result-query.js';
import type { AuditResult } from '../shared/audit.js';
import { resultView, sectionSchema } from './result-pages.js';
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
  storedPage(authorization: unknown, id: string, input: unknown) {
    const owner = this.auth.authenticate(authorization);
    const parsed = resultQuerySchema.safeParse(input);
    if (!auditIdSchema.safeParse(id).success || !parsed.success)
      throw new JobError('invalid_request', 'Invalid result pagination');
    const page = this.store.resultPage(id, owner, parsed.data);
    if (!page) throw new JobError('job_not_found', 'Audit job not found');
    return page;
  }
  mcpPage(authorization: unknown, id: string, section: unknown, limit: number, token?: string) {
    this.auth.authenticate(authorization);
    const decoded = token ? decodeCursor(token) : undefined;
    if (decoded && decoded.kind !== 'results')
      throw new JobError('invalid_request', 'Cursor belongs to another endpoint');
    const view = this.resultsPage(authorization, id, section, limit, decoded?.position);
    const { nextCursor, ...rest } = view;
    const cursor = nextCursor
      ? encodeCursor({ v: 1, kind: 'results', position: nextCursor })
      : null;
    return { ...rest, page: { nextCursor: cursor, hasMore: cursor !== null } };
  }
  status(authorization: unknown, id: string) {
    const owner = this.auth.authenticate(authorization);
    if (!auditIdSchema.safeParse(id).success)
      throw new JobError('invalid_request', 'Invalid audit ID');
    const result = this.store.status(id, owner);
    if (!result) throw new JobError('job_not_found', 'Audit job not found');
    return { ...toPublicJob(result.job), publishedResult: result.header };
  }

  page(authorization: unknown, id: string, section: ResultQuery['section'], input: unknown) {
    // Authenticate before decoding so cursor errors cannot disclose job existence.
    this.auth.authenticate(authorization);
    const parsed = pageInputSchema.safeParse(input);
    if (!parsed.success) throw new JobError('invalid_request', 'Invalid page query');
    const decoded = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : undefined;
    if (decoded && decoded.kind !== 'results')
      throw new JobError('invalid_request', 'Cursor belongs to another endpoint');
    const cursor = decoded?.position;
    const requestedFilter = parsed.data.filter === 'missing_alt' ? 'missing' : parsed.data.filter;
    const filter = requestedFilter ?? cursor?.filter ?? 'all';
    if (section !== 'inventory' && filter !== 'all')
      throw new JobError('invalid_request', 'Filters apply only to images');
    const result = this.storedPage(authorization, id, {
      section,
      filter,
      limit: parsed.data.limit,
      ...(cursor ? { cursor } : {}),
    });
    const nextCursor = result.hasMore
      ? encodeCursor({
          v: 1,
          kind: 'results',
          position: {
            jobId: id,
            attempt: result.header!.attempt,
            section,
            filter,
            after: result.items.at(-1)!.ordinal,
          },
        })
      : null;
    return {
      id,
      state: result.state,
      available: !!result.header,
      attempt: result.header?.attempt ?? null,
      total: result.total,
      items: result.items.map((i) => i.value),
      page: { nextCursor, hasMore: nextCursor !== null },
    };
  }
  recent(authorization: unknown, input: unknown) {
    this.auth.authenticate(authorization);
    const parsed = pageInputSchema.omit({ filter: true }).safeParse(input);
    if (!parsed.success) throw new JobError('invalid_request', 'Invalid list query');
    const decoded = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : undefined;
    if (decoded && decoded.kind !== 'audits')
      throw new JobError('invalid_request', 'Cursor belongs to another endpoint');
    const result = this.listPage(authorization, parsed.data.limit, decoded?.position);
    const nextCursor = result.nextCursor
      ? encodeCursor({ v: 1, kind: 'audits', position: result.nextCursor })
      : null;
    return { items: result.jobs, page: { nextCursor, hasMore: nextCursor !== null } };
  }
  inventoryPage(authorization: unknown, id: string, input: unknown) {
    const query = resultQuerySchema.safeParse(input);
    if (!query.success) throw new JobError('invalid_request', 'Invalid inventory query');
    const page = this.storedPage(authorization, id, { ...query.data, section: 'inventory' });
    return {
      attempt: page.header?.attempt ?? 0,
      items: page.items.map((i) => i.value as InventoryRow),
      total: page.total,
      nextCursor: page.hasMore
        ? {
            jobId: id,
            attempt: page.header!.attempt,
            section: 'inventory' as const,
            filter: query.data.filter,
            after: page.items.at(-1)!.ordinal,
          }
        : null,
    };
  }
  overview(authorization: unknown, id: string) {
    const page = this.storedPage(authorization, id, { section: 'summary' });
    return { id, state: page.state, available: !!page.header, header: page.header };
  }
  resultsPage(
    authorization: unknown,
    id: string,
    section: unknown = 'issues',
    limit = 10,
    cursor?: ResultCursor,
  ) {
    const parsed = sectionSchema.safeParse(section);
    if (!parsed.success || limit > 20)
      throw new JobError('invalid_request', 'Invalid result pagination');
    const query: ResultQuery = {
      section: parsed.data,
      filter: 'all',
      limit,
      ...(cursor ? { cursor } : {}),
    };
    const page = this.storedPage(authorization, id, query);
    let result: AuditResult | null = null;
    if (page.header) {
      result = {
        ...page.header.metadata,
        resources: [],
        occurrences: [],
        issues: [],
        coverage: { complete: page.header.metadata.coverage.complete, findings: [] },
      };
      const values = page.items.map((i) => i.value);
      if (section === 'candidates')
        result.occurrences = (values as InventoryRow[]).map((row) => ({
          ...row.occurrence,
          candidates: row.candidate ? [row.candidate] : [],
        }));
      else if (section === 'coverage')
        result.coverage.findings = values as AuditResult['coverage']['findings'];
      else if (section !== 'summary') Object.assign(result, { [parsed.data]: values });
    }
    const view = resultView(id, page.state, result, parsed.data, limit);
    const consumed = view.items.length;
    const more = page.hasMore || consumed < page.items.length;
    return {
      ...view,
      total: page.total,
      summary: page.header?.summary ?? null,
      attempt: page.header?.attempt ?? null,
      nextCursor:
        more && consumed
          ? {
              jobId: id,
              attempt: page.header!.attempt,
              section: parsed.data,
              filter: 'all' as const,
              after: page.items[consumed - 1]!.ordinal,
            }
          : null,
    };
  }
  listPage(authorization: unknown, limit = 20, before?: JobCursor) {
    const owner = this.auth.authenticate(authorization);
    const parsed = listAuditsSchema.safeParse({ limit, before });
    if (!parsed.success) throw new JobError('invalid_request', 'Invalid list pagination');
    const rows = this.store.list(limit + 1, owner, before);
    const jobs = rows.slice(0, limit).map(toPublicJob);
    const last = jobs.at(-1);
    return {
      jobs,
      nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }
  list(authorization: unknown, limit = 20, before?: JobCursor) {
    const userId = this.auth.authenticate(authorization);
    const parsed = listAuditsSchema.safeParse({ limit, before });
    if (!parsed.success)
      throw new JobError('invalid_request', 'Invalid limit or pagination cursor');
    return this.store.list(parsed.data.limit, userId, parsed.data.before).map(toPublicJob);
  }
}
