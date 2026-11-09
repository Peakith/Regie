import { useCallback, useEffect, useState } from 'react';
import { errText } from './supabase';
import { useLive } from './live';

/** Laadt data; geeft fouten zichtbaar terug in plaats van ze te verbergen. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { tick } = useLive();
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  // Live verversen (realtime / focus / 30 s) zonder het scherm leeg te maken.
  useEffect(() => { if (tick > 0) void run().then((d) => { setData(d); setError(''); }).catch(() => {}); }, [tick]); // eslint-disable-line
  return { data, error, loading, reload, setData };
}
