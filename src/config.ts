import { resolve } from 'node:path';
import { createUrlPolicy } from './application/audit/policy.js';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const fixtureMode = env['AUDIT_FIXTURE_MODE'] === '1';
  const approvedHosts = fixtureMode ? ['127.0.0.1:3105'] : (env['AUDIT_APPROVED_HOSTS'] ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  createUrlPolicy(approvedHosts); // Fail fast for malformed configuration.
  return {
    fixtureMode,
    databasePath: resolve(fixtureMode ? 'data/demo/audits.sqlite' : env['AUDIT_DB_PATH'] ?? 'data/audits.sqlite'),
    approvedHosts,
  };
}
