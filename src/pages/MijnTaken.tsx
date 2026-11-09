import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, errText, must } from '../lib/supabase';
import { useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { dagKort, isVerlopen, taskStatusLabel } from '../lib/labels';
import { Loading, Msg, Pill } from '../components/ui';

type T = { id: string; title: string; deadline: string | null; status: string; revision: number; project_id: string | null; list_id: string | null;
  project: { name: string } | null; task_list: { name: string } | null };

/** Alle open taken op jouw naam, over projecten en lijsten heen. */
export default function MijnTaken() {
  const ctx = useCtx();
  const [done, setDone] = useState(false);
  const { data, error, loading, reload } = useLoad(async () => {
    if (!ctx.person_id) return [] as T[];
    let q = supabase.from('task').select('id,title,deadline,status,revision,project_id,list_id,project(name),task_list(name)')
      .eq('assignee_person_id', ctx.person_id).order('deadline', { ascending: true, nullsFirst: false });
    if (!done) q = q.not('status', 'in', '(klaar,vervallen)');
    return must(await q) as T[];
  }, [ctx.person_id, done]);
  const [err, setErr] = useState('');
  async function setStatus(t: T, status: string) {
    const { data: r, error } = await supabase.from('task').update({ status }).eq('id', t.id).eq('revision', t.revision).select('id');
    setErr(error ? errText(error) : !r?.length ? 'Deze taak is intussen gewijzigd; nieuwste stand geladen.' : '');
    await reload();
  }
  if (loading && !data) return <Loading />;
  return (
    <>
      <div className="row between"><h1>Mijn taken</h1>
        <label className="inline"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Ook afgeronde</label></div>
      {!ctx.person_id && <Msg kind="warn">Je account is nog niet aan een persoon gekoppeld.</Msg>}
      <Msg>{error}</Msg><Msg>{err}</Msg>
      {data?.length === 0 ? <div className="card muted">Geen taken op jouw naam.</div> : (
        <table className="list">
          <thead><tr><th>Taak</th><th>Waar</th><th>Deadline</th><th>Status</th></tr></thead>
          <tbody>
            {data?.map((t) => (
              <tr key={t.id}>
                <td data-label="Taak"><strong>{t.title}</strong></td>
                <td data-label="Waar">{t.project_id ? <Link to={`/projecten/${t.project_id}?tab=Taken`}>{t.project?.name}</Link> : t.task_list ? <Link to="/lijsten">{t.task_list.name}</Link> : 'Losse taak'}</td>
                <td data-label="Deadline">{isVerlopen(t.deadline) && !['klaar', 'vervallen'].includes(t.status) ? <Pill tone="danger">{dagKort(t.deadline)}</Pill> : dagKort(t.deadline)}</td>
                <td data-label="Status">
                  <select aria-label={`Status ${t.title}`} value={t.status} onChange={(e) => setStatus(t, e.target.value)}>
                    {Object.entries(taskStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
