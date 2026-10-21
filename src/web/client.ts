import type { AuditJob } from '../shared/jobs.js';
export type { ResultsResponse } from '../shared/jobs.js';

export const isActive = (job: AuditJob) => job.state === 'queued' || job.state === 'running';

export async function requestAuditApi<T>(
  token: string,
  path: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/audits' + path, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: 'no-store',
      redirect: 'error',
      headers: { ...init.headers, Authorization: 'Bearer ' + token },
    });
  } catch {
    throw new Error('Could not reach the local API within 10 seconds. Check the API and retry.');
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new Error('Token not accepted. Disconnect and enter a valid demo token.');
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? 'Request failed (HTTP ' + response.status + ').');
  }
  return response.json() as Promise<T>;
}
