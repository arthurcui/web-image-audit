import type { JobError } from '../application/jobs.js';
/** Transport mapping; application errors deliberately have no HTTP status. */
export const httpErrorStatus: Record<JobError['code'], number> = {
  invalid_request: 400,
  invalid_idempotency_key: 400,
  invalid_target: 400,
  unauthorized: 401,
  origin_not_allowed: 403,
  job_not_found: 404,
  idempotency_conflict: 409,
  demo_busy: 503,
  mcp_unavailable: 503,
};
