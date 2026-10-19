import { resolve } from 'node:path';
import { createUrlPolicy } from './application/audit/policy.js';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const approvedHosts = (env['AUDIT_APPROVED_HOSTS'] ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  createUrlPolicy(approvedHosts); // Fail fast for malformed configuration.
  return {
    databasePath: resolve(env['AUDIT_DB_PATH'] ?? 'data/audits.sqlite'),
    approvedHosts,
  };
}
