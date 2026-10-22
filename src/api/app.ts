import { Readable } from 'node:stream';
import { exportAudit } from '../application/export-audit.js';
import * as z from 'zod/v4';

import { httpErrorStatus } from './errors.js';
import { getReadiness } from '../application/readiness.js';
import type { ReadinessStore } from '../application/readiness.js';
import Fastify from 'fastify';
import { McpDemoBridge, demoCallSchema } from './mcp-bridge.js';
import type { Writable } from 'node:stream';
import { getHealth } from '../application/health.js';
import { DemoAuth } from '../application/auth.js';
import type { TokenRepository } from '../application/auth.js';
import { AuditService } from '../application/audit-service.js';
import { JobError } from '../application/jobs.js';
import type { AuditRepository } from '../application/jobs.js';
import { SqliteJobStore } from '../infrastructure/sqlite/job-store.js';

const origins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
const corsHeaders = new Set(['authorization', 'content-type', 'idempotency-key']);

export function buildApp(
  options: {
    readinessStore?: ReadinessStore;
    fixtureMode?: boolean;
    logger?: boolean;
    logStream?: Writable;
    store?: AuditRepository & TokenRepository;
    approvedHosts?: readonly string[];
    mcpDatabasePath?: string;
  } = {},
) {
  const app = Fastify({
    logger: options.logger
      ? {
          // Omit URLs, headers, and bodies, including on malformed/unauthenticated requests.
          serializers: { req: (request) => ({ method: request.method }) },
          redact: ['req.headers.authorization', 'headers.authorization', 'authorization'],
          ...(options.logStream ? { stream: options.logStream } : {}),
        }
      : false,
    bodyLimit: 8192,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const store = options.store ?? new SqliteJobStore(':memory:');
  if (!options.store)
    app.addHook('onClose', async () => {
      (store as SqliteJobStore).close();
    });
  const auth = new DemoAuth(store);
  const audits = new AuditService(store, auth, options.approvedHosts ?? []);

  const bridge = options.mcpDatabasePath
    ? new McpDemoBridge({
        databasePath: options.mcpDatabasePath,
        approvedHosts: options.approvedHosts ?? [],
      })
    : null;
  app.addHook('onClose', async () => {
    await bridge?.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof JobError) {
      const status = httpErrorStatus[error.code] ?? 500;
      if (status === 401) reply.header('WWW-Authenticate', 'Bearer');
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    const detail = error as { validation?: unknown; statusCode?: number; code?: string };
    if (detail.validation)
      return reply.code(400).send({
        error: { code: 'invalid_request', message: 'Request does not match the required schema' },
      });
    if (detail.code === 'SQLITE_BUSY' || detail.code === 'SQLITE_BUSY_SNAPSHOT') {
      return reply
        .header('Retry-After', '1')
        .code(503)
        .send({ error: { code: 'database_busy', message: 'Database busy; retry the request' } });
    }
    const status =
      detail.statusCode && detail.statusCode >= 400 && detail.statusCode < 500
        ? detail.statusCode
        : 500;
    if (status === 500) app.log.error({ code: 'internal_error' }, 'Request failed');
    return reply.code(status).send({
      error: {
        code: status === 500 ? 'internal_error' : 'invalid_request',
        message: status === 500 ? 'Unexpected server error' : 'Invalid request',
      },
    });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Vary', 'Origin');
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!origins.has(origin)) throw new JobError('origin_not_allowed', 'Origin is not allowed');
      reply.header('Access-Control-Allow-Origin', origin);
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const requested = (request.headers['access-control-request-headers'] ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      if (
        !origin ||
        (method !== 'GET' && method !== 'POST') ||
        requested.some((h) => !corsHeaders.has(h))
      ) {
        throw new JobError('origin_not_allowed', 'Preflight is not allowed');
      }
      return reply
        .header('Access-Control-Allow-Methods', 'GET, POST')
        .header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key')
        .code(204)
        .send();
    }
    // Early authentication avoids body/schema errors becoming an unauthenticated oracle.
    if (request.routeOptions.url?.startsWith('/api/audits'))
      auth.authenticate(request.headers.authorization);
  });
  app.options('/api/audits', async (_request, reply) => reply.code(204).send());
  app.options('/api/audits/*', async (_request, reply) => reply.code(204).send());
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );
  app.get('/api/ready', async (_request, reply) => {
    const result = getReadiness(
      options.readinessStore ?? (store instanceof SqliteJobStore ? store : undefined),
    );
    return reply.code(result.status === 'ready' ? 200 : 503).send(result);
  });
  app.get('/api/health', async () => ({
    ...getHealth(),
    ...(options.fixtureMode ? { mode: 'fixture' } : {}),
  }));
  app.post('/api/audits', async (request, reply) => {
    const { job, replayed } = audits.create(
      request.headers.authorization,
      request.body,
      request.headers['idempotency-key'],
    );
    request.log.info({ event: 'audit_created', auditId: job.id, replayed }, 'Audit queued');
    const statusUrl = '/api/audits/' + job.id;
    return reply
      .code(202)
      .header('Location', statusUrl)
      .send({
        id: job.id,
        state: job.state,
        statusUrl,
        imagesUrl: statusUrl + '/images',
        replayed,
      });
  });
  app.post('/api/audits/mcp-demo', async (request, reply) => {
    auth.authenticate(request.headers.authorization);
    const parsed = demoCallSchema.safeParse(request.body);
    if (!parsed.success)
      throw new JobError('invalid_request', 'Unsupported MCP demo command or arguments.');
    if (!bridge)
      throw new JobError('mcp_unavailable', 'MCP demo requires a configured persistent database.');
    const controller = new AbortController();
    const cancel = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', cancel);
    try {
      return await bridge.call(request.headers.authorization!, parsed.data, controller.signal);
    } finally {
      reply.raw.off('close', cancel);
    }
  });
  app.get<{ Params: { id: string } }>('/api/audits/:id', async (request) =>
    audits.status(request.headers.authorization, request.params.id),
  );
  const querySchema = z.strictObject({
    cursor: z.string().optional(),
    limit: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .transform(Number)
      .optional(),
  });
  for (const [endpoint, section] of [
    ['images', 'inventory'],
    ['resources', 'resources'],
    ['documents', 'documents'],
    ['issues', 'issues'],
  ] as const) {
    app.get<{ Params: { id: string } }>('/api/audits/:id/' + endpoint, async (request) => {
      const schema =
        endpoint === 'images' ? querySchema.extend({ filter: z.string().optional() }) : querySchema;
      const query = schema.safeParse(request.query);
      if (!query.success) throw new JobError('invalid_request', 'Invalid page query');
      return audits.page(request.headers.authorization, request.params.id, section, query.data);
    });
  }
  app.get<{ Params: { id: string } }>('/api/audits/:id/export', async (request, reply) => {
    const query = z.strictObject({ format: z.enum(['json', 'csv']) }).safeParse(request.query);
    if (!query.success) throw new JobError('invalid_request', 'Invalid export format');
    const chunks = exportAudit(
      audits,
      request.headers.authorization,
      request.params.id,
      query.data.format,
    );
    return reply
      .header(
        'Content-Disposition',
        'attachment; filename="audit-' + request.params.id + '.' + query.data.format + '"',
      )
      .type(query.data.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8')
      .send(Readable.from(chunks));
  });
  app.get('/api/audits', async (request) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) throw new JobError('invalid_request', 'Invalid audit list query');
    return audits.recent(request.headers.authorization, query.data);
  });
  return app;
}
