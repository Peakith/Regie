import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { useCtx, useSession } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { dagKort, isVerlopen } from '../lib/labels';
import { Field, Loading, Msg, Pill } from '../components/ui';

type L = { id: string; name: string; owner: string; shared: boolean };
type T = { id: string; title: string; deadline: string | null; status: string; revision: number; list_id: string | null; assignee_person_id: string | null; created_by: string };

/** Losse takenlijsten zonder fases, template of project (bijv. "Boodschappen kantoor"). */
export default function Lijsten() {
  const ctx = useCtx();
  const { data, error, loading, reload } = useLoad(async () => ({
    lists: must(await supabase.from('task_list').select('id,name,owner,shared').is('project_id', null).order('created_at')) as L[],
    tasks: must(await supabase.from('task').select('id,title,deadline,status,revision,list_id,assignee_person_id,created_by').is('project_id', null).order('created_at')) as T[],
    people: must(await supabase.from('person').select('id,full_name,user_id').not('user_id', 'is', null).order('full_name')) as { id: string; full_name: string }[],
  }), []);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState('');
  async function addList(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('task_list').insert({ workspace_id: ctx.workspace_id, name, shared });
    if (error) return setErr(errText(error));
    setName(''); setShared(false); setErr('');
    await reload();
  }
  if (loading && !data) return <Loading />;
  const loose = (data?.tasks ?? []).filter((t) => !t.list_id);
  return (
    <>
      <h1>Lijsten</h1>
      <p className="muted small">Eenvoudige takenlijsten, los van projecten. Een privélijst zie alleen jij; een gedeelde lijst ziet het hele interne team.</p>
      <Msg>{error}</Msg><Msg>{err}</Msg>
      {data?.lists.map((l) => <ListCard key={l.id} list={l} tasks={(data.tasks).filter((t) => t.list_id === l.id)} people={data.people} reload={reload} />)}
      {loose.length > 0 && <ListCard list={{ id: '', name: 'Losse taken (persoonlijk)', owner: '', shared: false }} tasks={loose} people={data?.people ?? []} reload={reload} />}
      <form className="card" onSubmit={addList}>
        <h2>Nieuwe lijst</h2>
        <div className="row">
          <input aria-label="Naam lijst" required placeholder="bijv. Boodschappen kantoor" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
          <label className="inline"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Delen met het team</label>
          <button className="primary">Aanmaken</button>
        </div>
      </form>
    </>
  );
}

function ListCard({ list, tasks, people, reload }: { list: L; tasks: T[]; people: { id: string; full_name: string }[]; reload: () => Promise<void> }) {
  const ctx = useCtx();
  const { session } = useSession();
  const [f, setF] = useState({ title: '', deadline: '', assignee: '' });
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('task').insert({ workspace_id: ctx.workspace_id, list_id: list.id || null, title: f.title, deadline: f.deadline || null, assignee_person_id: f.assignee || null });
    if (error) return setErr(errText(error));
    setF({ title: '', deadline: '', assignee: '' }); setErr('');
    await reload();
  }
  async function toggle(t: T) {
    const { data, error } = await supabase.from('task').update({ status: t.status === 'klaar' ? 'te_doen' : 'klaar' }).eq('id', t.id).eq('revision', t.revision).select('id');
    setErr(error ? errText(error) : !data?.length ? 'Intussen gewijzigd; nieuwste stand geladen.' : '');
    await reload();
  }
  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{list.name} {list.shared && <Pill tone="info">Gedeeld</Pill>}</h2>
        {list.id && list.owner === session?.user.id && (
          <button className="link small" onClick={async () => { if (!confirm(`Lijst "${list.name}" verwijderen? Herstellen kan 30 dagen.`)) return; const { error } = await supabase.rpc('soft_delete', { p_kind: 'list', p_id: list.id }); setErr(error ? errText(error) : ''); await reload(); }}>Lijst verwijderen</button>
        )}
      </div>
      <ul className="plain">
        {tasks.map((t) => (
          <li key={t.id} className="row">
            <label className="inline"><input type="checkbox" checked={t.status === 'klaar'} onChange={() => toggle(t)} />
              <span style={{ textDecoration: t.status === 'klaar' ? 'line-through' : undefined }}>{t.title}</span></label>
            {t.deadline && (isVerlopen(t.deadline) && t.status !== 'klaar' ? <Pill tone="danger">{dagKort(t.deadline)}</Pill> : <span className="small muted">{dagKort(t.deadline)}</span>)}
            {t.assignee_person_id && <span className="small muted">{people.find((p) => p.id === t.assignee_person_id)?.full_name}</span>}
          </li>
        ))}
        {tasks.length === 0 && <li className="muted small">Nog leeg.</li>}
      </ul>
      <form className="row" onSubmit={add} style={{ marginTop: 8 }}>
        <input aria-label="Nieuwe taak" required placeholder="Nieuwe taak" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
        <Field id={`d-${list.id}`} label="Deadline"><input id={`d-${list.id}`} type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        {list.shared && (
          <select aria-label="Verantwoordelijke" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} style={{ maxWidth: 180 }}>
            <option value="">Niemand</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
        <button>Toevoegen</button>
      </form>
      <Msg>{err}</Msg>
    </div>
  );
}
