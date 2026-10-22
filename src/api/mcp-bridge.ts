/**
 * The authenticated demo endpoint owns a short-lived stdio MCP client for each command.
 * This client adapter lives in the API layer to manage credentials, cancellation and process
 * cleanup; it forwards the authenticated token, never a caller-supplied user identity.
 */
import { auditUrlSchema, auditIdSchema, idempotencyKeySchema } from '../shared/inputs.js';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as z from 'zod/v4';
import { JobError } from '../application/jobs.js';

const id = auditIdSchema;
export const demoCallSchema = z.discriminatedUnion('name', [
  z.strictObject({
    name: z.literal('start_audit'),
    arguments: z.strictObject({
      url: auditUrlSchema,
      idempotencyKey: idempotencyKeySchema,
    }),
  }),
  z.strictObject({ name: z.literal('get_audit_status'), arguments: z.strictObject({ id }) }),
  z.strictObject({
    name: z.literal('get_audit_results'),
    arguments: z.strictObject({
      id,
      section: z.literal('issues'),
      limit: z.number().int().min(1).max(20),
      cursor: z.string().min(1).max(2048).optional(),
    }),
  }),
  z.strictObject({
    name: z.literal('list_audits'),
    arguments: z.strictObject({ limit: z.number().int().min(1).max(20) }),
  }),
]);
/** One short-lived stdio process per command; no global/shared user session. */
export class McpDemoBridge {
  private readonly clients = new Set<Client>();
  private stopped = false;
  constructor(
    private readonly config: { databasePath: string; approvedHosts: readonly string[] },
  ) {}
  async call(authorization: string, input: z.infer<typeof demoCallSchema>, signal: AbortSignal) {
    if (this.stopped || this.clients.size >= 4)
      throw new JobError('demo_busy', 'MCP demo is busy. Retry shortly.');
    const client = new Client(
      { name: 'website-image-audit-demo', version: '0.1.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    this.clients.add(client);
    const source = import.meta.url.endsWith('.ts');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        ...(source ? ['--import', 'tsx'] : []),
        fileURLToPath(new URL(source ? '../mcp/main.ts' : '../mcp/main.js', import.meta.url)),
      ],
      env: {
        AUDIT_DB_PATH: this.config.databasePath,
        AUDIT_APPROVED_HOSTS: this.config.approvedHosts.join(','),
        AUDIT_DEMO_TOKEN: authorization.slice(7),
      },
      stderr: 'ignore',
      maxBufferSize: 131_072,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => {
          reject(new Error('aborted'));
          void client.close().catch(() => {});
        };
        timer = setTimeout(abort, 8000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      const operation = async () => {
        if (signal.aborted) throw new Error('aborted');
        await client.connect(transport);
        const result = await client.callTool(input);
        if (Buffer.byteLength(JSON.stringify(result)) > 65_536) throw new Error('oversized');
        return { transport: 'stdio' as const, tool: input.name, result };
      };
      return await Promise.race([operation(), interrupted]);
    } catch {
      throw new JobError(
        'mcp_unavailable',
        'MCP call could not finish. Retry the command; start retries keep the same idempotency key.',
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      await client.close().catch(() => {});
      this.clients.delete(client);
    }
  }
  async close() {
    this.stopped = true;
    await Promise.allSettled([...this.clients].map((client) => client.close()));
  }
}
