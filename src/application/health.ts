// Provide the API liveness response independently of dependency readiness.
import type { HealthResponse } from '../shared/health.js';

// Liveness only; no database or worker readiness is implied.
export function getHealth(): HealthResponse {
  return { status: 'ok', service: 'website-image-audit' };
}
