// Poll active work while avoiding overlapping requests and stale updates.
import { useEffect, useState } from 'react';

/** One request at a time; terminal snapshots and failures require no timer. */
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  active: (value: T) => boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError('');
    setLoading(true);
    async function run() {
      try {
        const next = await load(controller.signal);
        if (!live) return;
        setData(next);
        setLoading(false);
        if (active(next))
          timer = setTimeout(() => {
            void run();
          }, 1500);
      } catch (cause) {
        if (live) {
          setError(cause instanceof Error ? cause.message : 'Unable to load audits.');
          setLoading(false);
        }
      }
    }
    void run();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [load, active, revision]);
  return { data, error, loading, refresh: () => setRevision((value) => value + 1) };
}
