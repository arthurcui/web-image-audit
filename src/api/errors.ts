// Map application error codes to HTTP status codes.
import type { JobError } from '../application/jobs.js';
/** Transport mapping; application errors deliberately have no HTTP status. */
export const httpErrorStatus: Record<JobError['code'], number> = {
  demo_busy: 503,
  idempotency_conflict: 409,
  invalid_idempotency_key: 400,
  invalid_request: 400,
  invalid_target: 400,
  job_not_found: 404,
  mcp_unavailable: 503,
  origin_not_allowed: 403,
  stale_cursor: 409,
  unauthorized: 401,
};
