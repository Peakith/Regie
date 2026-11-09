import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { anchorLabel, dagKort, isVerlopen, phaseLabel, taskStatusLabel } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import Opmerkingen from '../../components/Opmerkingen';
import type { TabProps } from './types';

export type Task = {
  id: string; title: string; description: string | null; assignee_person_id: string | null; deadline: string | null; priority: number;
  status: string; parent_id: string | null; revision: number; created_by: string; phase_group: string | null; anchor: string | null;
  anchor_offset: number | null; deadline_manual: boolean; shoot_day_id: string | null; sort: number;
  task_deliverable: { deliverable: { id: string; title: string } | null }[];
  task_dependency: { blocked_by: string }[];
};

const GROUPS = ['pre_productie', 'productie', 'post_productie', 'afronding', ''];

export default function Taken({ project, canEdit, canManage, people }: TabProps) {
  const { data, error, loading, reload } = useLoad(async () => {
    const tasks = must(await supabase.from('task').select('*, task_deliverable(deliverable(id,title)), task_dependency!task_dependency_task_id_fkey(blocked_by)')
      .eq('project_id', project.id).order('sort').order('created_at')) as Task[];
    const delivs = must(await supabase.from('deliverable').select('id,title').eq('project_id', project.id).order('sort')) as { id: string; title: string }[];
    return { tasks, delivs };
  }, [project.id]);
  const [view, setView] = useState<'lijst' | 'bord'>('lijst');
  const [filter, setFilter] = useState({ status: 'open', person: '' });
  const [err, setErr] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);

  async function patch(t: Task, values: Record<string, unknown>) {
    setErr('');
    const { data: res, error } = await supabase.from('task').update(values).eq('id', t.id).eq('revision', t.revision).select('id');
    if (error) setErr(errText(error));
    else if (!res?.length) setErr(`"${t.title}" is intussen door iemand anders gewijzigd. Er is niets overschreven; de nieuwste stand is geladen.`);
    await reload();
  }

  if (loading && !data) return <Loading />;
  const all = data?.tasks ?? [];
  const visible = all.filter((t) => (filter.status === 'open' ? !['klaar', 'vervallen'].includes(t.status) : filter.status ? t.status === filter.status : true)
    && (!filter.person || t.assignee_person_id === filter.person));
  const roots = visible.filter((t) => !t.parent_id || !visible.some((x) => x.id === t.parent_id));
  const children = (id: string) => visible.filter((t) => t.parent_id === id);
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? '—';
  const blockedOpen = (t: Task) => t.task_dependency.map((d) => all.find((x) => x.id === d.blocked_by)).filter((x) => x && !['klaar', 'vervallen'].includes(x.status)) as Task[];

  const row = (t: Task, depth = 0) => (
    <tr key={t.id}>
      <td data-label="Taak" style={{ paddingLeft: 12 + depth * 20 }}>
        {depth > 0 && <span className="muted">↳ </span>}
        <button className="link" style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }} onClick={() => setOpenTask(openTask === t.id ? null : t.id)}>{t.title}</button>
        {t.task_deliverable.length > 0 && <div className="small muted">{t.task_deliverable.map((x) => x.deliverable?.title).filter(Boolean).join(', ')}</div>}
        {blockedOpen(t).length > 0 && <div><Pill tone="warn">Wacht op: {blockedOpen(t).map((b) => b.title).join(', ')}</Pill></div>}
        {openTask === t.id && <TaskDetail t={t} all={all} delivs={data?.delivs ?? []} canEdit={canEdit} canManage={canManage} projectId={project.id} reload={reload} />}
      </td>
      <td data-label="Verantwoordelijke">
        {canEdit ? (
          <select aria-label={`Verantwoordelijke ${t.title}`} value={t.assignee_person_id ?? ''} onChange={(e) => patch(t, { assignee_person_id: e.target.value || null })}>
            <option value="">Niemand</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        ) : name(t.assignee_person_id)}
      </td>
      <td data-label="Deadline">
        {canEdit ? (
          <input type="date" aria-label={`Deadline ${t.title}`} value={t.deadline ?? ''} onChange={(e) => patch(t, { deadline: e.target.value || null })}
            style={isVerlopen(t.deadline) && !['klaar', 'vervallen'].includes(t.status) ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined} />
        ) : dagKort(t.deadline)}
        {t.anchor && <div className="small muted">{t.anchor}{(t.anchor_offset ?? 0) >= 0 ? '+' : ''}{t.anchor_offset} t.o.v. {anchorLabel[t.anchor]}{t.deadline_manual ? ' · handmatig aangepast' : ''}</div>}
      </td>
      <td data-label="Status">
        <select aria-label={`Status ${t.title}`} disabled={!canEdit} value={t.status} onChange={(e) => patch(t, { status: e.target.value })}>
          {Object.entries(taskStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
    </tr>
  );
  const renderTree = (t: Task, depth = 0): JSX.Element[] => [row(t, depth), ...children(t.id).flatMap((c) => renderTree(c, depth + 1))];

  return (
    <>
      <Msg>{error}</Msg>
      <Msg>{err}</Msg>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="tabs" role="tablist" style={{ margin: 0, border: 0 }}>
          <button role="tab" aria-selected={view === 'lijst'} onClick={() => setView('lijst')}>Lijst</button>
          <button role="tab" aria-selected={view === 'bord'} onClick={() => setView('bord')}>Bord</button>
        </div>
        <select aria-label="Filter status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} style={{ maxWidth: 170 }}>
          <option value="open">Open taken</option><option value="">Alle taken</option>
          {Object.entries(taskStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Filter verantwoordelijke" value={filter.person} onChange={(e) => setFilter({ ...filter, person: e.target.value })} style={{ maxWidth: 200 }}>
          <option value="">Iedereen</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>
      {visible.length === 0 ? <div className="card muted">Geen taken voor dit filter.</div> : view === 'lijst' ? (
        GROUPS.map((g) => {
          const rs = roots.filter((t) => (t.phase_group ?? '') === g);
          if (!rs.length) return null;
          return (
            <div key={g} style={{ marginBottom: 16 }}>
              <h3>{g ? phaseLabel[g] : 'Overig'}</h3>
              <table className="list">
                <thead><tr><th>Taak</th><th>Verantwoordelijke</th><th>Deadline</th><th>Status</th></tr></thead>
                <tbody>{rs.flatMap((t) => renderTree(t))}</tbody>
              </table>
            </div>
          );
        })
      ) : (
        <div className="board">
          {['te_doen', 'bezig', 'geblokkeerd', 'klaar'].map((st) => (
            <div key={st} className="col">
              <h3>{taskStatusLabel[st]}</h3>
              {visible.filter((t) => t.status === st).map((t) => (
                <div key={t.id} className="item">
                  <strong>{t.title}</strong>
                  <div className="small muted">{name(t.assignee_person_id)} · {dagKort(t.deadline)}</div>
                  {canEdit && (
                    <select aria-label={`Status ${t.title}`} value={t.status} onChange={(e) => patch(t, { status: e.target.value })}>
                      {Object.entries(taskStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {canEdit && <AddTask project={project} people={people} tasks={all} delivs={data?.delivs ?? []} reload={reload} />}
    </>
  );
}

function TaskDetail({ t, all, delivs, canEdit, canManage, projectId, reload }: {
  t: Task; all: Task[]; delivs: { id: string; title: string }[]; canEdit: boolean; canManage: boolean; projectId: string; reload: () => Promise<void>;
}) {
  const [desc, setDesc] = useState(t.description ?? '');
  const [dep, setDep] = useState('');
  const [deliv, setDeliv] = useState('');
  const [err, setErr] = useState('');
  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    const { error } = await fn();
    setErr(error ? errText(error) : '');
    await reload();
  }
  return (
    <div className="card" style={{ marginTop: 8, padding: 12 }}>
      <Field id={`td-${t.id}`} label="Omschrijving">
        <textarea id={`td-${t.id}`} disabled={!canEdit} value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
      </Field>
      {canEdit && <button onClick={() => run(() => supabase.from('task').update({ description: desc || null }).eq('id', t.id).eq('revision', t.revision).select())}>Omschrijving opslaan</button>}
      <h3>Afhankelijk van</h3>
      {t.task_dependency.map((d) => {
        const b = all.find((x) => x.id === d.blocked_by);
        return <div key={d.blocked_by} className="small">{b?.title ?? 'onbekend'} ({b ? b.status : ''}) {canEdit && <button className="link" onClick={() => run(() => supabase.from('task_dependency').delete().eq('task_id', t.id).eq('blocked_by', d.blocked_by))}>loskoppelen</button>}</div>;
      })}
      {canEdit && (
        <div className="row">
          <select aria-label="Geblokkeerd door" value={dep} onChange={(e) => setDep(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Kies taak…</option>
            {all.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
          <button disabled={!dep} onClick={() => run(() => supabase.from('task_dependency').insert({ task_id: t.id, blocked_by: dep }).select())}>Toevoegen</button>
        </div>
      )}
      <h3>Deliverables</h3>
      <div className="small">{t.task_deliverable.map((x) => x.deliverable?.title).filter(Boolean).join(', ') || '—'}</div>
      {canEdit && (
        <div className="row">
          <select aria-label="Deliverable koppelen" value={deliv} onChange={(e) => setDeliv(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Kies deliverable…</option>
            {delivs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <button disabled={!deliv} onClick={() => run(() => supabase.from('task_deliverable').insert({ task_id: t.id, deliverable_id: deliv }).select())}>Koppelen</button>
        </div>
      )}
      <h3>Opmerkingen</h3>
      <Opmerkingen projectId={projectId} subjectType="task" subjectId={t.id} canEdit={canEdit} allowCrew />
      {canManage && <div style={{ marginTop: 8 }}><button className="danger" onClick={() => { if (confirm('Taak (en subtaken) naar de prullenbak?')) void run(() => supabase.rpc('soft_delete', { p_kind: 'task', p_id: t.id })); }}>Verwijderen</button></div>}
      <Msg>{err}</Msg>
    </div>
  );
}

function AddTask({ project, people, tasks, delivs, reload }: { project: TabProps['project']; people: TabProps['people']; tasks: Task[]; delivs: { id: string; title: string }[]; reload: () => Promise<void> }) {
  const [f, setF] = useState({ title: '', assignee: '', deadline: '', deliverable: '', parent: '', phase: '', priority: '2' });
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const parent = tasks.find((t) => t.id === f.parent);
      const t = must(await supabase.from('task').insert({
        workspace_id: project.workspace_id, project_id: project.id, title: f.title, assignee_person_id: f.assignee || null,
        deadline: f.deadline || null, parent_id: f.parent || null, phase_group: parent?.phase_group ?? (f.phase || null), priority: Number(f.priority),
      }).select().single()) as Task;
      if (f.deliverable) must(await supabase.from('task_deliverable').insert({ task_id: t.id, deliverable_id: f.deliverable }).select());
      setF({ ...f, title: '', deadline: '', deliverable: '', parent: '' });
    } catch (e2) { setErr(errText(e2)); }
    await reload();
  }
  return (
    <form className="card" onSubmit={add} style={{ marginTop: 16 }}>
      <h2>Taak toevoegen</h2>
      <div className="grid2">
        <Field id="tt" label="Titel"><input id="tt" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field id="ta" label="Verantwoordelijke">
          <select id="ta" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
            <option value="">Niemand</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field id="td" label="Deadline"><input id="td" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        <Field id="tph" label="Fase">
          <select id="tph" value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>
            <option value="">Overig</option>{GROUPS.filter(Boolean).map((g) => <option key={g} value={g}>{phaseLabel[g]}</option>)}
          </select>
        </Field>
        <Field id="tpr" label="Prioriteit">
          <select id="tpr" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="1">Hoog</option><option value="2">Normaal</option><option value="3">Laag</option>
          </select>
        </Field>
        <Field id="tdl" label="Hoort bij deliverable">
          <select id="tdl" value={f.deliverable} onChange={(e) => setF({ ...f, deliverable: e.target.value })}>
            <option value="">Geen</option>{delivs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </Field>
        <Field id="tp" label="Subtaak van" hint="Subtaken gaan maximaal één niveau diep.">
          <select id="tp" value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}>
            <option value="">Geen (hoofdtaak)</option>{tasks.filter((t) => !t.parent_id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
      </div>
      <Msg>{err}</Msg>
      <button className="primary">Toevoegen</button>
    </form>
  );
}
