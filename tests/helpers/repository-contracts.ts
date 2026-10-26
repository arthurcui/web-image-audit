// Assert repository privilege boundaries at compile time.
import type { AuditRepository, WorkerQueue } from '../../src/application/jobs.js';
import type { TokenRepository } from '../../src/application/auth.js';

// Compile-only assertions; this function is never executed.
export function repositoryCapabilities(
  audits: AuditRepository,
  queue: WorkerQueue,
  tokens: TokenRepository,
) {
  // @ts-expect-error Public reads require an owner.
  audits.get('id');
  // @ts-expect-error Results require an owner.
  audits.results('id');
  // @ts-expect-error Lists require an owner.
  audits.list(10);
  // @ts-expect-error Creation requires an explicit owner.
  audits.create('https://example.com', undefined);
  // @ts-expect-error Public repositories cannot claim cross-owner jobs.
  audits.claim(30_000);
  // @ts-expect-error Workers have no arbitrary public read method.
  queue.get('id', 'alice');
  // @ts-expect-error Workers do not have token access.
  queue.tokenUser('hash');
  // @ts-expect-error Token repositories do not expose audits.
  tokens.list(10, 'alice');
}
