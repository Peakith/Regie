import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL of VITE_SUPABASE_ANON_KEY ontbreekt. Draai eerst: npm run env:lokaal');
}

export const supabase = createClient(url, key);

/** Begrijpelijke foutmelding uit een Supabase/Postgres-fout. */
export function errText(e: unknown): string {
  if (!e) return '';
  const m = (e as { message?: string }).message ?? String(e);
  if (m.includes('row-level security')) return 'Je hebt geen rechten voor deze handeling.';
  if (m.includes('Failed to fetch')) return 'Geen verbinding met de server. Er is niets opgeslagen.';
  return m;
}

/** Gooit bij een fout, zodat er nooit een vals succes wordt getoond. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must(res: { data: unknown; error: unknown }): any {
  if (res.error) throw res.error;
  return res.data;
}
