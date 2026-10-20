import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Project installer output wins over inherited user-cache paths in watch processes. */
export function browserExecutable(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | undefined {
  let manifest: string;
  try { manifest = readFileSync(resolve(cwd, 'data/browser-runtime.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read project browser configuration; run npm run browser:install');
    const configured = env['AUDIT_BROWSER_EXECUTABLE'];
    return configured ? resolve(cwd, configured) : undefined;
  }
  const value = JSON.parse(manifest) as { executablePath?: unknown };
  if (typeof value.executablePath !== 'string' || !value.executablePath.trim()) throw new Error('Invalid project browser configuration; run npm run browser:install');
  return resolve(cwd, value.executablePath);
}
