import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { isOwnerOrAdmin, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { datumTijd, roleLabel } from '../lib/labels';
import { Field, Loading, Msg, Pill } from '../components/ui';

type Member = { user_id: string; email: string; role: string; person_name: string | null; revoked_at: string | null };

export default function Instellingen() {
  const ctx = useCtx();
  const admin = isOwnerOrAdmin(ctx.role);
  const { data, error, loading, reload } = useLoad(async () =>
    admin ? (must(await supabase.rpc('list_members', { p_ws: ctx.workspace_id })) as Member[]) : [], [admin, ctx.workspace_id]);
  const [f, setF] = useState({ email: '', name: '', role: 'stagiair' });
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('add_member', { p_ws: ctx.workspace_id, p_email: f.email, p_role: f.role, p_full_name: f.name });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    setMsg({ kind: 'ok', text: `${f.email} is toegevoegd als ${roleLabel[f.role]}. Geef deze persoon daarna toegang tot de juiste projecten (tab Beheer van een project).` });
    setF({ email: '', name: '', role: 'stagiair' });
    await reload();
  }

  async function revoke(m: Member) {
    if (!confirm(`Toegang van ${m.email} intrekken? Nieuwe verzoeken worden direct geweigerd. Historie blijft bewaard.`)) return;
    const { error } = await supabase.rpc('revoke_member', { p_ws: ctx.workspace_id, p_user: m.user_id });
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Toegang ingetrokken.' });
    await reload();
  }

  return (
    <>
      <h1>Instellingen</h1>
      <div className="card">
        <div className="kv">
          <span className="muted">Werkruimte</span><span>{ctx.workspace_name}</span>
          <span className="muted">Jouw rol</span><span>{roleLabel[ctx.role]}</span>
        </div>
      </div>
      {!admin ? <p className="muted">Ledenbeheer is alleen beschikbaar voor eigenaar en admin.</p> : (
        <>
          <form className="card" onSubmit={add}>
            <h2>Interne gebruiker toevoegen</h2>
            <Msg kind="info">Lokale werkwijze voor fase 1: de persoon maakt eerst zelf een account aan op het inlogscherm; daarna voeg je dat e-mailadres hier toe. Echte uitnodigingen per e-mail volgen in fase 3.</Msg>
            <div className="grid2">
              <Field id="me" label="E-mailadres van het account"><input id="me" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field id="mn" label="Naam"><input id="mn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field id="mr" label="Rol" hint="Stagiair: ziet alleen projecten waartoe je toegang geeft, en daarin alleen eigen toegewezen taken.">
                <select id="mr" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                  {['stagiair', 'medewerker', 'projectmanager', ...(ctx.role === 'eigenaar' ? ['admin'] : [])].map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </Field>
            </div>
            <button className="primary">Toevoegen</button>
          </form>
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <Msg>{error}</Msg>
          {loading && !data ? <Loading /> : (
            <table className="list">
              <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th></th></tr></thead>
              <tbody>
                {data?.map((m) => (
                  <tr key={m.user_id}>
                    <td data-label="Naam">{m.person_name ?? '—'}</td>
                    <td data-label="E-mail">{m.email}</td>
                    <td data-label="Rol">{roleLabel[m.role]} {m.revoked_at && <Pill tone="danger">Ingetrokken {datumTijd(m.revoked_at)}</Pill>}</td>
                    <td>{!m.revoked_at && m.role !== 'eigenaar' && <button className="danger" onClick={() => revoke(m)}>Toegang intrekken</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
