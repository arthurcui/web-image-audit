// Maintain the worker heartbeat used by readiness probes.
import { randomUUID } from 'node:crypto';
import { workerHeartbeatIntervalMs } from '../application/readiness.js';
import type { ReadinessStore } from '../application/readiness.js';

/** Process presence is separate from job leases: idle and busy workers both renew it. */
export function startWorkerPresence(store: ReadinessStore, onError: () => void) {
  const id = randomUUID();
  store.recordWorkerHeartbeat(id);
  const timer = setInterval(() => {
    try {
      store.recordWorkerHeartbeat(id);
    } catch {
      onError();
    }
  }, workerHeartbeatIntervalMs);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      store.removeWorkerHeartbeat(id);
    } catch {
      onError();
    }
  };
}
