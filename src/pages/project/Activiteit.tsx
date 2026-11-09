import { useState } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { datumTijd } from '../../lib/labels';
import { Loading, Msg, Pill } from '../../components/ui';
import Opmerkingen from '../../components/Opmerkingen';
import type { TabProps } from './types';

type Audit = { id: number; actor: string | null; action: string; table_name: string; changes: Record<string, unknown>; reason: string | null; at: string };
type Run = { id: string; kind: string; summary: string | null; status: string; created_at: string; trigger: string | null };

const tableLabel: Record<string, string> = {
  project: 'Project', project_number: 'Projectnummer', project_member: 'Projectteam', deliverable: 'Deliverable', deliverable_version: 'Versie',
  approval: 'Goedkeuring', shoot_day: 'Draaidag', assignment: 'Crew/editor', task: 'Taak', task_deliverable: 'Taakkoppeling', milestone: 'Mijlpaal',
  equipment_item: 'Apparatuur', decision: 'Besluit', external_link: 'Link', comment: 'Opmerking', task_list: 'Lijst',
};
const kindLabel: Record<string, string> = { AU1: 'Template toegepast', AU2: 'Deadlines meegeschoven', AU7: 'Fase', AU10: 'Bruto' };

export default function Activiteit({ project, canManage, canEdit, people, reloadProject }: TabProps) {
  const { data, error, loading, reload } = useLoad(async () => ({
    audit: must(await supabase.from('audit_log').select('id,actor,action,table_name,changes,reason,at').eq('project_id', project.id).order('at', { ascending: false }).limit(100)) as Audit[],
    runs: must(await supabase.from('automation_run').select('id,kind,summary,status,created_at,trigger').eq('project_id', project.id).order('created_at', { ascending: false }).limit(30)) as Run[],
  }), [project.id]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const nameOf = (uid: string | null) => people.find((p) => p.user_id === uid)?.full_name ?? (uid ? 'Gebruiker' : 'Systeem');
  if (loading && !data) return <Loading />;
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Msg>{error}</Msg>
      <div className="card">
        <h2>Opmerkingen bij het project</h2>
        <Opmerkingen projectId={project.id} subjectType="project" subjectId={project.id} canEdit={canEdit} allowCrew />
      </div>
      <div className="card">
        <h2>Automatiseringen</h2>
        {data?.runs.length === 0 && <p className="muted small">Nog geen automatiseringen uitgevoerd.</p>}
        <ul className="plain">
          {data?.runs.map((r) => (
            <li key={r.id} className="small">
              <Pill tone={r.status === 'ok' ? 'info' : r.status === 'fout' ? 'danger' : undefined}>{kindLabel[r.kind] ?? r.kind}</Pill> {r.summary}
              <span className="muted"> · {datumTijd(r.created_at)}{r.status !== 'ok' ? ` · ${r.status}` : ''}</span>
              {canManage && r.status === 'ok' && ((r.kind === 'AU1' && Date.now() - new Date(r.created_at).getTime() < 86_400_000) || r.kind === 'AU2') && (
                <> · <button className="link" onClick={async () => {
                  if (!confirm('Deze automatisering ongedaan maken? Onderdelen die je intussen hebt gewijzigd blijven staan.')) return;
                  const { data: res, error } = await supabase.rpc('undo_automation', { p_run: r.id });
                  setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: `Ongedaan gemaakt: ${res}.` });
                  await reload(); await reloadProject();
                }}>ongedaan maken</button></>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Wijzigingshistorie</h2>
        <table className="list">
          <tbody>
            {data?.audit.map((a) => (
              <tr key={a.id}>
                <td data-label="Wanneer" className="small">{datumTijd(a.at)}</td>
                <td data-label="Wie" className="small">{nameOf(a.actor)}</td>
                <td data-label="Wat" className="small">
                  {tableLabel[a.table_name] ?? a.table_name} {a.action === 'insert' ? 'aangemaakt' : a.action === 'update' ? 'gewijzigd' : 'verwijderd'}
                  {a.action === 'update' && <span className="muted">: {Object.entries(a.changes).map(([k, v]) => {
                    const c = v as { oud: unknown; nieuw: unknown };
                    return ['phase', 'status', 'deadline', 'date', 'checked_at'].includes(k) ? `${k} ${String(c.oud ?? '—')} → ${String(c.nieuw ?? '—')}` : k;
                  }).join(', ')}</span>}
                  {a.reason && <div>Reden: {a.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.audit.length === 0 && <p className="muted small">Nog geen wijzigingen.</p>}
      </div>
    </>
  );
}
