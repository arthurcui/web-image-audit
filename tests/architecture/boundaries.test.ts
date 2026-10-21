import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('layer rules reject type-only imports and re-exports while allowing shared contracts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wia-boundaries-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const layer of ['web', 'application', 'infrastructure', 'shared']) {
    await mkdir(join(directory, 'src', layer), { recursive: true });
  }
  await writeFile(join(directory, 'src/infrastructure/store.ts'), 'export interface Store {}');
  await writeFile(
    join(directory, 'src/application/jobs.ts'),
    "export type { Store } from '../infrastructure/store.js';",
  );
  await writeFile(
    join(directory, 'src/web/client.ts'),
    "import type { Store } from '../application/jobs.js'; export type Client = Store;",
  );
  await writeFile(
    join(directory, 'src/shared/contracts.ts'),
    "export type { Store } from '../application/jobs.js';",
  );
  const check = () =>
    spawnSync(
      process.execPath,
      [
        resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        '--config',
        resolve('.dependency-cruiser.json'),
        'src',
      ],
      { cwd: directory, encoding: 'utf8' },
    );
  const rejected = check();
  assert.ifError(rejected.error);
  assert.notEqual(rejected.status, 0);
  const output = rejected.stdout + rejected.stderr;
  for (const rule of [
    'web-only-web-and-shared',
    'application-only-application-and-shared',
    'shared-only-shared',
  ]) {
    assert.ok(output.includes(rule), output);
  }
  await writeFile(join(directory, 'src/shared/contracts.ts'), 'export interface AuditJob {}');
  await writeFile(
    join(directory, 'src/application/jobs.ts'),
    "export type { AuditJob } from '../shared/contracts.js';",
  );
  await writeFile(
    join(directory, 'src/web/client.ts'),
    "import type { AuditJob } from '../shared/contracts.js'; export type Client = AuditJob;",
  );
  const allowed = check();
  assert.ifError(allowed.error);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
});
