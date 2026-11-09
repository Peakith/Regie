import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL of VITE_SUPABASE_ANON_KEY ontbreekt. Draai eerst: npm run env:lokaal');
}

// Telt lopende schrijfacties, zodat de interface "Bezig met opslaan" / "Opgeslagen" kan tonen.
type SyncListener = (pending: number, lastError: boolean) => void;
const listeners = new Set<SyncListener>();
let pending = 0;
export function onSync(fn: SyncListener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = (err: boolean) => listeners.forEach((l) => l(pending, err));

const trackedFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const isRpcRead = typeof input === 'string' && /\/rpc\/(dashboard|search_all|project_status|register_year_overview|template_preview|booking_conflicts|offline_snapshot|crew_|trash_items|system_status|list_|export_data|tasks_of_deactivated|my_context|organization_exists|can_)/.test(input);
  const write = method !== 'GET' && method !== 'HEAD' && !isRpcRead;
  if (write) { pending++; emit(false); }
  try {
    const res = await fetch(input, init);
    if (write) { pending--; emit(!res.ok); }
    return res;
  } catch (e) {
    if (write) { pending--; emit(true); }
    throw e;
  }
};

export const supabase = createClient(url, key, { global: { fetch: trackedFetch } });

/** Begrijpelijke foutmelding uit een Supabase/Postgres-fout. */
export function errText(e: unknown): string {
  if (!e) return '';
  const m = (e as { message?: string }).message ?? String(e);
  if (m.includes('row-level security')) return 'Je hebt geen rechten voor deze handeling.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed')) return 'Geen verbinding met de server. Er is niets opgeslagen; je invoer staat nog in het formulier.';
  if (m.includes('permission denied')) return 'Je hebt geen rechten voor deze handeling.';
  return m;
}

/** Gooit bij een fout, zodat er nooit een vals succes wordt getoond. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must(res: { data: unknown; error: unknown }): any {
  if (res.error) throw res.error;
  return res.data;
}
