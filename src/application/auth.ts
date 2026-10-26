// Provision opaque tokens and authenticate callers using stored token hashes.
import { createHash, randomBytes } from 'node:crypto';
import { JobError } from './jobs.js';

export interface TokenRepository {
  saveToken(hash: string, userId: string): void;
  tokenUser(hash: string): string | undefined;
}
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
/** Provision for a trusted local identity; only fixture bootstrap exposes a fixed demo identity. */
export function provisionToken(store: TokenRepository, userId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(userId)) {
    throw new Error(
      'User ID must start with a letter or digit and contain at most 64 letters, digits, dots, underscores, or hyphens',
    );
  }
  const token = 'wia_' + randomBytes(32).toString('base64url');
  store.saveToken(tokenHash(token), userId);
  return token;
}
export interface Authenticator {
  authenticate(authorization: unknown): string;
}
export class DemoAuth implements Authenticator {
  constructor(private readonly store: TokenRepository) {}
  authenticate(authorization: unknown): string {
    const match =
      typeof authorization === 'string'
        ? /^Bearer (wia_[A-Za-z0-9_-]{43})$/i.exec(authorization)
        : null;
    const userId = match ? this.store.tokenUser(tokenHash(match[1]!)) : undefined;
    if (!userId || userId === '__legacy__') {
      throw new JobError('unauthorized', 'A valid bearer token is required');
    }
    return userId;
  }
}
