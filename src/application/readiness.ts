// Evaluate database access and worker heartbeat freshness for readiness.
import type { ReadinessResponse } from '../shared/health.js';

export const workerHeartbeatIntervalMs = 5_000;
export const workerStaleAfterMs = 15_000;
export interface ReadinessStore {
  probeReadiness(): { workerReady: boolean };
  recordWorkerHeartbeat(id: string): void;
  removeWorkerHeartbeat(id: string): void;
}
export function getReadiness(store?: ReadinessStore): ReadinessResponse {
  try {
    if (!store) throw new Error('Readiness store unavailable');
    const { workerReady } = store.probeReadiness();
    return {
      status: workerReady ? 'ready' : 'not_ready',
      checks: {
        database: 'ready',
        worker: workerReady ? 'ready' : 'unavailable',
      },
    };
  } catch {
    return { status: 'not_ready', checks: { database: 'unavailable', worker: 'unknown' } };
  }
}
