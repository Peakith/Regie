import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onSync, supabase } from './supabase';

/**
 * Live verversen: wijzigingen van andere apparaten verschijnen via realtime (indien beschikbaar),
 * en anders door te verversen bij focus en elke 30 seconden. `tick` verandert bij elke verversing.
 */
type Live = { tick: number; online: boolean; saving: boolean; saveError: boolean; realtime: boolean; bump: () => void };
const LiveContext = createContext<Live>({ tick: 0, online: true, saving: false, saveError: false, realtime: false, bump: () => {} });

const TABLES = ['project', 'project_number', 'task', 'deliverable', 'deliverable_version', 'shoot_day', 'assignment',
  'equipment_item', 'milestone', 'comment', 'notification', 'decision', 'external_link', 'task_list'];

export function LiveProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [tick, setTick] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const timer = useRef<number | undefined>();

  const bump = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTick((t) => t + 1), 250); // bundel snelle opeenvolgende wijzigingen
  };

  useEffect(() => onSync((pending, err) => { setSaving(pending > 0); if (pending === 0) setSaveError(err); }), []);

  useEffect(() => {
    const on = () => { setOnline(true); bump(); };
    const off = () => setOnline(false);
    const focus = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('focus', focus);
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) bump(); }, 30_000);
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', focus); window.removeEventListener('focus', focus);
      window.clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel('regie-live');
    TABLES.forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => bump()));
    ch.subscribe((status) => setRealtime(status === 'SUBSCRIBED'));
    return () => { void supabase.removeChannel(ch); };
  }, [enabled]);

  return <LiveContext.Provider value={{ tick, online, saving, saveError, realtime, bump }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

export function SyncStatus() {
  const { online, saving, saveError, realtime } = useLive();
  let text = 'Opgeslagen'; let tone = 'ok';
  if (!online) { text = 'Offline: wijzigingen niet mogelijk'; tone = 'danger'; }
  else if (saving) { text = 'Bezig met opslaan…'; tone = 'info'; }
  else if (saveError) { text = 'Laatste wijziging niet opgeslagen'; tone = 'warn'; }
  return (
    <span className={`pill ${tone}`} role="status" aria-live="polite" title={realtime ? 'Live verbonden' : 'Ververst bij focus en elke 30 seconden'}>
      {text}
    </span>
  );
}
