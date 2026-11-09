import { useCallback, useEffect, useState } from 'react';
import { errText } from './supabase';

/** Laadt data; geeft fouten zichtbaar terug in plaats van ze te verbergen. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  return { data, error, loading, reload, setData };
}
