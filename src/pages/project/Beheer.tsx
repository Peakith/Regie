import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { isOwnerOrAdmin, useCtx } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';
import { datumTijd, nummerWaarschuwing, roleLabel } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type Member = { user_id: string; email: string; role: string; person_name: string | null; revoked_at: string | null };
type Audit = { id: number; actor: string | null; action: string; table_name: string; changes: Record<string, unknown>; reason: string | null; at: string };

const tableLabel: Record<string, string> = {
  project: 'Project', project_number: 'Projectnummer', project_member: 'Projecttoegang', deliverable: 'Deliverable',
  deliverable_version: 'Versie', approval: 'Akkoord', shoot_day: 'Draaidag', assignment: 'Inzet', task: 'Taak', task_deliverable: 'Taakkoppeling',
};

export default function Beheer({ project, canManage, reloadProject }: TabProps) {
  const ctx = useCtx();
  const admin = isOwnerOrAdmin(ctx.role);
  const { data, loading, error, reload } = useLoad(async () => {
    const members = (must(await supabase.from('project_member').select('user_id').eq('project_id', project.id)) as { user_id: string }[]).map((m) => m.user_id);
    const all = admin ? (must(await supabase.rpc('list_members', { p_ws: ctx.workspace_id })) as Member[]) : [];
    const audit = admin ? (must(await supabase.from('audit_log').select('id,actor,action,table_name,changes,reason,at').eq('project_id', project.id).order('at', { ascending: false }).limit(50)) as Audit[]) : [];
    return { members, all, audit };
  }, [project.id, admin, project.revision]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [reason, setReason] = useState('');
  const [addUser, setAddUser] = useState('');

  const primary = project.project_number.find((n) => n.kind === 'primair');
  const aliases = project.project_number.filter((n) => n.kind === 'alias');

  async function act(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    const { error } = await fn();
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: ok });
    if (!error) { setNewNumber(''); setReason(''); setAddUser(''); }
    await reloadProject();
    await reload();
  }

  function submitNumber(e: FormEvent) {
    e.preventDefault();
    if (!primary) void act(() => supabase.rpc('set_project_number', { p_project: project.id, p_number: newNumber }), 'Projectnummer geregistreerd.');
    else void act(() => supabase.rpc('correct_project_number', { p_project: project.id, p_new_number: newNumber, p_reason: reason }), 'Nummer gecorrigeerd; het oude nummer blijft als alias gereserveerd.');
  }

  const nameOf = (uid: string | null) => data?.all.find((m) => m.user_id === uid)?.person_name ?? (uid ? 'Onbekend' : 'Systeem');
  const memberRows = data?.all.filter((m) => data.members.includes(m.user_id)) ?? [];
  const candidates = data?.all.filter((m) => !m.revoked_at && !data.members.includes(m.user_id) && !['eigenaar', 'admin'].includes(m.role)) ?? [];

  if (loading && !data) return <Loading />;
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Msg>{error}</Msg>
      <div className="card">
        <h2>Projectnummer</h2>
        <p>{primary ? <><strong>{primary.number_display}</strong> <span className="small muted">geregistreerd {datumTijd(primary.created_at)}</span></> : <Pill tone="warn">Nog geen nummer (concept)</Pill>}</p>
        {aliases.map((a) => <p key={a.number_display} className="small muted">Oud nummer {a.number_display} blijft gereserveerd en vindbaar · reden: {a.reason}</p>)}
        {((!primary && canManage) || (primary && admin)) && (
          <form onSubmit={submitNumber}>
            <div className="grid2">
              <Field id="nn" label={primary ? 'Gecorrigeerd nummer' : 'Projectnummer'}><input id="nn" required value={newNumber} onChange={(e) => setNewNumber(e.target.value)} /></Field>
              {primary && <Field id="nr" label="Reden van correctie"><input id="nr" required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
            </div>
            {nummerWaarschuwing(newNumber) && <Msg kind="warn">{nummerWaarschuwing(newNumber)}</Msg>}
            <button>{primary ? 'Nummer corrigeren' : 'Nummer registreren'}</button>
          </form>
        )}
        {primary && !admin && <p className="hint">Alleen eigenaar of admin kan een nummer corrigeren.</p>}
      </div>

      <div className="card">
        <h2>Projecttoegang</h2>
        <p className="muted small">Eigenaar en admin zien alle projecten. Projectmanagers, medewerkers en stagiairs zien alleen projecten waar ze hier zijn toegevoegd.</p>
        {!admin ? <p className="small">Projecttoegang wordt beheerd door eigenaar of admin.</p> : (
          <>
            {memberRows.map((m) => (
              <div key={m.user_id} className="row" style={{ marginBottom: 6 }}>
                <span>{m.person_name ?? m.email} <span className="muted small">· {roleLabel[m.role]}</span></span>
                {!['eigenaar', 'admin'].includes(m.role) && (
                  <button className="link" onClick={() => act(() => supabase.rpc('remove_project_member', { p_project: project.id, p_user: m.user_id }), 'Toegang tot project verwijderd.')}>verwijderen</button>
                )}
              </div>
            ))}
            {candidates.length > 0 && (
              <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => supabase.rpc('add_project_member', { p_project: project.id, p_user: addUser }), 'Toegang gegeven.'); }}>
                <select aria-label="Gebruiker" required value={addUser} onChange={(e) => setAddUser(e.target.value)} style={{ maxWidth: 260 }}>
                  <option value="">Kies gebruiker…</option>
                  {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.person_name ?? m.email} ({roleLabel[m.role]})</option>)}
                </select>
                <button>Toegang geven</button>
              </form>
            )}
          </>
        )}
      </div>

      {canManage && (
        <div className="card">
          <h2>Archief</h2>
          <p className="small muted">Archiveren verbergt het project uit de lopende lijst. Het nummer blijft gereserveerd en het project blijft vindbaar via "Alle statussen".</p>
          <button onClick={() => act(() => supabase.rpc('set_project_archived', { p_project: project.id, p_archived: !project.archived }), project.archived ? 'Uit archief gehaald.' : 'Gearchiveerd.')}>
            {project.archived ? 'Uit archief halen' : 'Archiveren'}
          </button>
        </div>
      )}

      {admin && (
        <div className="card">
          <h2>Wijzigingshistorie</h2>
          {data?.audit.length === 0 && <p className="muted small">Nog geen wijzigingen.</p>}
          <table className="list">
            <tbody>
              {data?.audit.map((a) => (
                <tr key={a.id}>
                  <td data-label="Wanneer" className="small">{datumTijd(a.at)}</td>
                  <td data-label="Wie" className="small">{nameOf(a.actor)}</td>
                  <td data-label="Wat" className="small">
                    {tableLabel[a.table_name] ?? a.table_name} {a.action === 'insert' ? 'aangemaakt' : a.action === 'update' ? 'gewijzigd' : 'verwijderd'}
                    {a.action === 'update' && <span className="muted">: {Object.keys(a.changes).join(', ')}</span>}
                    {a.reason && <div>Reden: {a.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
