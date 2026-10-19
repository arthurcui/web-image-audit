export interface HealthResponse {
  status: 'ok';
  service: 'website-image-audit';
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null
    && 'status' in value && value.status === 'ok'
    && 'service' in value && value.service === 'website-image-audit';
}
