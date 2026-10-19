import Fastify from 'fastify';
import { getHealth } from '../application/health.js';
import { createUrlPolicy } from '../application/audit/policy.js';
import { JobError } from '../application/jobs.js';
import type { JobStore } from '../application/jobs.js';
import { SqliteJobStore } from '../infrastructure/job-store.js';

export function buildApp(options: { logger?: boolean; store?: JobStore; approvedHosts?: readonly string[] } = {}) {
  const app = Fastify({
    logger: options.logger ?? false, bodyLimit: 8192,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const store = options.store ?? new SqliteJobStore(':memory:');
  if (!options.store) app.addHook('onClose', async () => { (store as SqliteJobStore).close(); });
  const policy = createUrlPolicy(options.approvedHosts ?? []);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof JobError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    const detail = error as { validation?: unknown; statusCode?: number; code?: string };
    if (detail.validation) return reply.code(400).send({ error: { code: 'invalid_request', message: 'Request does not match the required schema' } });
    if (detail.code === 'SQLITE_BUSY' || detail.code === 'SQLITE_BUSY_SNAPSHOT') {
      return reply.header('Retry-After', '1').code(503).send({ error: { code: 'database_busy', message: 'Database busy; retry the request' } });
    }
    const status = detail.statusCode && detail.statusCode >= 400 && detail.statusCode < 500 ? detail.statusCode : 500;
    if (status === 500) app.log.error(error);
    return reply.code(status).send({ error: {
      code: status === 500 ? 'internal_error' : 'invalid_request',
      message: status === 500 ? 'Unexpected server error' : 'Invalid request',
    } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }));
  app.get('/api/health', async () => getHealth());

  app.post<{ Body: { url: string } }>('/api/audits', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['url'],
      properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } } } },
  }, async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))) {
      throw new JobError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 1-128 letters, digits, dot, underscore, colon, or hyphen');
    }
    let url: string;
    try { url = policy(request.body.url).href; }
    catch (error) { throw new JobError(400, 'invalid_target', error instanceof Error ? error.message : 'Invalid URL'); }
    const { job, replayed } = store.create(url, key);
    const statusUrl = '/api/audits/' + job.id;
    return reply.code(202).header('Location', statusUrl).send({
      id: job.id, state: job.state, statusUrl, resultsUrl: statusUrl + '/results', replayed,
    });
  });

  const params = { type: 'object', required: ['id'], additionalProperties: false,
    properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } } };
  app.get<{ Params: { id: string } }>('/api/audits/:id', { schema: { params } }, async (request) => {
    const job = store.get(request.params.id);
    if (!job) throw new JobError(404, 'job_not_found', 'Audit job not found');
    return job;
  });
  app.get<{ Params: { id: string } }>('/api/audits/:id/results', { schema: { params } }, async (request) => {
    const snapshot = store.results(request.params.id);
    if (!snapshot) throw new JobError(404, 'job_not_found', 'Audit job not found');
    return { id: snapshot.job.id, state: snapshot.job.state,
      available: snapshot.result !== null, result: snapshot.result, attempts: snapshot.attempts };
  });
  app.get<{ Querystring: { limit?: string } }>('/api/audits', {
    schema: { querystring: { type: 'object', additionalProperties: false,
      properties: { limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' } } } },
  }, async (request) => ({ jobs: store.list(Number(request.query.limit ?? 20)) }));
  return app;
}
