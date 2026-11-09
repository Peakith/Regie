import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useCtx } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';
import { datum, isVerlopen, taskStatusLabel } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type Task = {
  id: string; title: string; description: string | null; assignee_person_id: string | null; deadline: string | null;
  status: string; required_for_close: boolean; parent_id: string | null; revision: number; created_by: string;
  task_deliverable: { deliverable: { id: string; title: string } }[];
};

export default function Taken({ project, canEdit, canManage, people }: TabProps) {
  const ctx = useCtx();
  const { data, error, loading, reload } = useLoad(async () => {
    const tasks = must(await supabase.from('task').select('*, task_deliverable(deliverable(id,title))')
      .eq('project_id', project.id).order('created_at')) as Task[];
    const delivs = must(await supabase.from('deliverable').select('id,title').eq('project_id', project.id).order('sort')) as { id: string; title: string }[];
    return { tasks, delivs };
  }, [project.id]);
  const [f, setF] = useState({ title: '', assignee: '', deadline: '', required: false, deliverable: '', parent: '' });
  const [err, setErr] = useState('');
  const isLimited = !canEdit;
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? '—';

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const t = must(await supabase.from('task').insert({
        workspace_id: project.workspace_id, project_id: project.id, title: f.title,
        assignee_person_id: isLimited ? ctx.person_id : (f.assignee || null), deadline: f.deadline || null,
        required_for_close: canManage && f.required, parent_id: f.parent || null,
      }).select().single()) as Task;
      if (f.deliverable) must(await supabase.from('task_deliverable').insert({ task_id: t.id, deliverable_id: f.deliverable }).select());
      setF({ title: '', assignee: '', deadline: '', required: false, deliverable: '', parent: '' });
    } catch (e2) { setErr(errText(e2)); }
    await reload();
  }

  async function patch(t: Task, values: Record<string, unknown>) {
    setErr('');
    const { data: res, error } = await supabase.from('task').update(values).eq('id', t.id).eq('revision', t.revision).select('id');
    if (error) setErr(errText(error));
    else if (!res?.length) setErr(`"${t.title}" is intussen door iemand anders gewijzigd. De nieuwste stand is geladen; probeer opnieuw.`);
    await reload();
  }

  if (loading && !data) return <Loading />;
  const tasks = data?.tasks ?? [];
  const roots = tasks.filter((t) => !t.parent_id || !tasks.some((x) => x.id === t.parent_id));
  const children = (id: string) => tasks.filter((t) => t.parent_id === id);

  const row = (t: Task, depth = 0) => (
    <tr key={t.id}>
      <td data-label="Taak" style={{ paddingLeft: 12 + depth * 20 }}>
        {depth > 0 && <span className="muted">↳ </span>}<strong>{t.title}</strong>
        {t.required_for_close && <> <Pill tone="warn">Verplicht voor afsluiten</Pill></>}
        {t.task_deliverable.length > 0 && <div className="small muted">{t.task_deliverable.map((x) => x.deliverable.title).join(', ')}</div>}
      </td>
      <td data-label="Verantwoordelijke">
        {canEdit ? (
          <select aria-label={`Verantwoordelijke ${t.title}`} value={t.assignee_person_id ?? ''} onChange={(e) => patch(t, { assignee_person_id: e.target.value || null })}>
            <option value="">Niemand</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        ) : name(t.assignee_person_id)}
      </td>
      <td data-label="Deadline">{isVerlopen(t.deadline) && !['klaar', 'vervallen'].includes(t.status) ? <Pill tone="danger">{datum(t.deadline)}</Pill> : datum(t.deadline)}</td>
      <td data-label="Status">
        <select aria-label={`Status ${t.title}`} value={t.status} onChange={(e) => patch(t, { status: e.target.value })}>
          {Object.entries(taskStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {t.status !== 'klaar' && t.status !== 'vervallen' && children(t.id).some((c) => !['klaar', 'vervallen'].includes(c.status)) && (
          <div className="small muted">Heeft open subtaken</div>
        )}
      </td>
    </tr>
  );
  const renderTree = (t: Task, depth = 0): JSX.Element[] => [row(t, depth), ...children(t.id).flatMap((c) => renderTree(c, depth + 1))];

  return (
    <>
      {isLimited && <Msg kind="info">Je ziet alleen taken die aan jou zijn toegewezen of die je zelf hebt gemaakt. Je kunt de status wijzigen.</Msg>}
      <Msg>{error}</Msg>
      <Msg>{err}</Msg>
      {tasks.length === 0 ? <div className="card muted">Geen taken.</div> : (
        <table className="list">
          <thead><tr><th>Taak</th><th>Verantwoordelijke</th><th>Deadline</th><th>Status</th></tr></thead>
          <tbody>{roots.flatMap((t) => renderTree(t))}</tbody>
        </table>
      )}
      <form className="card" onSubmit={add} style={{ marginTop: 16 }}>
        <h2>Taak toevoegen</h2>
        <div className="grid2">
          <Field id="tt" label="Titel"><input id="tt" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          {!isLimited && (
            <Field id="ta" label="Verantwoordelijke">
              <select id="ta" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
                <option value="">Niemand</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          )}
          <Field id="td" label="Deadline"><input id="td" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          {!isLimited && (
            <Field id="tdl" label="Hoort bij deliverable">
              <select id="tdl" value={f.deliverable} onChange={(e) => setF({ ...f, deliverable: e.target.value })}>
                <option value="">Geen</option>
                {data?.delivs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </Field>
          )}
          {!isLimited && (
            <Field id="tp" label="Subtaak van">
              <select id="tp" value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}>
                <option value="">Geen (hoofdtaak)</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
          )}
        </div>
        {canManage && (
          <div className="field"><label className="inline"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Verplicht voor operationeel afsluiten</label></div>
        )}
        <button className="primary">Toevoegen</button>
      </form>
    </>
  );
}
