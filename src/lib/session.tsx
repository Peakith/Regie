import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, errText } from './supabase';

export type Ctx = {
  workspace_id: string; workspace_name: string; organization_id: string;
  role: string; person_id: string | null; person_name: string | null;
};

type State = {
  session: Session | null;
  ctx: Ctx | null;
  orgExists: boolean;
  needsMfa: boolean;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<State | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [orgExists, setOrgExists] = useState(true);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(s: Session | null) {
    setLoading(true);
    setError('');
    try {
      if (!s) { setCtx(null); setNeedsMfa(false); return; }
      const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const mfa = !aal.error && aal.data.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2';
      setNeedsMfa(mfa);
      if (mfa) { setCtx(null); return; }
      const [c, o] = await Promise.all([supabase.rpc('my_context'), supabase.rpc('organization_exists')]);
      if (c.error) throw c.error;
      if (o.error) throw o.error;
      setCtx(((c.data as Ctx[]) ?? [])[0] ?? null);
      setOrgExists(Boolean(o.data));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); void load(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') { try { localStorage.removeItem('regie-offline'); } catch { /* */ } }
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'MFA_CHALLENGE_VERIFIED') void load(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ session, ctx, orgExists, needsMfa, loading, error, refresh: async () => { const { data } = await supabase.auth.getSession(); setSession(data.session); await load(data.session); } }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): State {
  const s = useContext(SessionContext);
  if (!s) throw new Error('SessionProvider ontbreekt');
  return s;
}

/** Ingelogd met werkruimte; alleen te gebruiken binnen de beveiligde layout. */
export function useCtx(): Ctx {
  const { ctx } = useSession();
  if (!ctx) throw new Error('Geen werkruimte');
  return ctx;
}

// Interfacehulpen volgens de rechtenmatrix (§3). De database dwingt dezelfde regels af; dit verbergt alleen knoppen.
export const isOwnerOrAdmin = (role: string) => role === 'eigenaar' || role === 'admin';
export const isManager = (role: string) => ['eigenaar', 'admin', 'projectmanager'].includes(role);
export const hasFinance = isManager;
export const canCreateProjects = (role: string) => ['eigenaar', 'admin', 'projectmanager', 'medewerker'].includes(role);
export const canApprove = canCreateProjects;
export const canEditPeople = canCreateProjects;
export const isInternal = (role: string) => ['eigenaar', 'admin', 'projectmanager', 'medewerker', 'stagiair'].includes(role);
