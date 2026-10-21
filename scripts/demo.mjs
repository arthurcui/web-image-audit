import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const env = { ...process.env, AUDIT_FIXTURE_MODE: '1' };
const command = process.argv[2];
if (command === 'token' || command === 'mcp') {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      command === 'token' ? 'src/cli/provision-token.ts' : 'src/mcp/main.ts',
      ...(command === 'token' ? process.argv.slice(3) : []),
    ],
    { env, stdio: 'inherit' },
  );
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  console.error(
    'FIXTURE MODE: isolated demo database; only 127.0.0.1:3105 is approved. Stop normal API/frontend/worker before starting.',
  );
  const children = [
    ['--import', 'tsx', 'src/demo/main.ts'],
    ['--import', 'tsx', 'src/api/main.ts'],
    ['--import', 'tsx', 'src/worker/main.ts'],
    [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js')],
  ].map((args) => spawn(process.execPath, args, { env, stdio: 'inherit' }));
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    if (process.connected) process.disconnect();
  };
  for (const child of children) {
    child.on('error', () => stop(1));
    child.on('exit', (code) => stop(code ?? 1));
  }
  process.on('message', (message) => {
    if (message === 'shutdown') stop();
  });
  process.once('disconnect', () => stop());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
}
