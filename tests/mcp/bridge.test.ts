import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/api/app.js';
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';
import { provisionToken } from '../../src/application/auth.js';

test(
  'HTTP demo calls the real stdio MCP server with each authenticated user and closes cleanly',
  { timeout: 20_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'wia-demo-'));
    const path = join(directory, 'audit.sqlite');
    const store = new SqliteJobStore(path);
    const alice = provisionToken(store, 'alice');
    const bob = provisionToken(store, 'bob');
    const app = buildApp({ store, approvedHosts: ['example.com'], mcpDatabasePath: path });
    t.after(async () => {
      await app.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    const invoke = (token: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/api/audits/mcp-demo',
        headers: { authorization: 'Bearer ' + token },
        payload,
      });
    const call = {
      name: 'start_audit',
      arguments: { url: 'https://example.com/', idempotencyKey: 'chat-key' },
    };
    const a = await invoke(alice, call);
    assert.equal(a.statusCode, 200);
    const result = a.json();
    assert.equal(result.transport, 'stdio');
    const id = result.result.structuredContent.data.id;
    assert.equal(store.get(id, 'alice')!.ownerId, 'alice');
    const repeat = (await invoke(alice, call)).json();
    assert.equal(repeat.result.structuredContent.data.id, id);
    const b = (await invoke(bob, call)).json();
    assert.notEqual(b.result.structuredContent.data.id, id);
    const foreign = (
      await invoke(bob, {
        name: 'get_audit_results',
        arguments: { id, section: 'issues', offset: 0, limit: 5 },
      })
    ).json();
    assert.equal(foreign.result.isError, true);
    assert.equal(foreign.result.structuredContent.error.code, 'job_not_found');
    const lists = await Promise.all(
      [alice, bob].map((token) => invoke(token, { name: 'list_audits', arguments: { limit: 5 } })),
    );
    assert.equal(lists[0]!.json().result.structuredContent.data.jobs[0].id, id);
    assert.notEqual(lists[1]!.json().result.structuredContent.data.jobs[0].id, id);
    assert.equal((await invoke('invalid', call)).statusCode, 401);
    assert.equal(
      (await invoke(alice, { name: 'run_shell', arguments: { command: 'whoami' } })).statusCode,
      400,
    );
    assert.equal((await invoke(alice, { ...call, userId: 'bob' })).statusCode, 400);
    assert.equal(
      (
        await invoke(alice, {
          name: 'get_audit_results',
          arguments: { id, section: 'issues', offset: 0, limit: 999 },
        })
      ).statusCode,
      400,
    );
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/audits/mcp-demo',
      headers: { authorization: 'Bearer ' + alice, origin: 'https://evil.invalid' },
      payload: call,
    });
    assert.equal(crossOrigin.statusCode, 403);
  },
);
