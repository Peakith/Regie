import { useState } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { isManager, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { anchorLabel, bedrijfLabel, datumTijd, phaseLabel } from '../lib/labels';
import { Field, Loading, Msg, Pill } from '../components/ui';

type TaskT = { title: string; phase?: string; anchor?: string; offset?: number; calendar?: boolean; per_deliverable?: boolean; description?: string; subtasks?: { title: string }[] };
type DelivT = { title: string; kind?: string; aspect_ratio?: string; feedback_rounds?: number; group?: string; format?: string; duration?: string; language?: string; channel?: string };
type Content = { freelancers_betaald?: boolean; no_shoot?: boolean; shoot_days: { title: string; offset_days: number }[]; deliverables: DelivT[]; tasks: TaskT[] };
type Tpl = { id: string; name: string; company: string | null; description: string | null; archived: boolean;
  template_version: { id: string; version_no: number; content: Content; created_at: string }[] };

const empty: Content = { freelancers_betaald: true, shoot_days: [{ title: 'Draaidag 1', offset_days: 0 }], deliverables: [], tasks: [] };

/** Templates met versies. Een nieuwe versie past bestaande projecten nooit aan. */
export default function Templates() {
  const ctx = useCtx();
  const mayEdit = isManager(ctx.role);
  const { data, error, loading, reload } = useLoad(async () => ({
    templates: must(await supabase.from('template').select('id,name,company,description,archived,template_version(id,version_no,content,created_at)').order('name')) as Tpl[],
    projects: must(await supabase.from('project').select('id,name').eq('archived', false).order('created_at', { ascending: false }).limit(100)) as { id: string; name: string }[],
  }), []);
  const [editing, setEditing] = useState<{ id: string | null; name: string; company: string; description: string; content: Content } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fromProject, setFromProject] = useState('');

  const latest = (t: Tpl) => t.template_version.slice().sort((a, b) => b.version_no - a.version_no)[0];

  async function save() {
    if (!editing) return;
    const { error } = await supabase.rpc('save_template', {
      p_ws: ctx.workspace_id, p_template: editing.id, p_name: editing.name, p_company: editing.company || null,
      p_description: editing.description || null, p_content: editing.content,
    });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    setMsg({ kind: 'ok', text: 'Nieuwe templateversie opgeslagen. Bestaande projecten blijven ongewijzigd.' });
    setEditing(null);
    await reload();
  }
  async function loadFromProject() {
    const { data: c, error } = await supabase.rpc('project_as_template_content', { p_project: fromProject });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    const p = data?.projects.find((x) => x.id === fromProject);
    setEditing({ id: null, name: `Template uit ${p?.name ?? 'project'}`, company: '', description: '', content: { ...empty, ...(c as Content) } });
  }

  if (loading && !data) return <Loading />;
  return (
    <>
      <div className="row between"><h1>Templates</h1>
        {mayEdit && !editing && <button className="primary" onClick={() => setEditing({ id: null, name: '', company: '', description: '', content: empty })}>Nieuwe template</button>}
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Msg>{error}</Msg>
      {editing ? <Editor value={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} /> : (
        <>
          {data?.templates.map((t) => {
            const v = latest(t);
            return (
              <details key={t.id} className="card">
                <summary>{t.name} {t.company && <Pill>{bedrijfLabel[t.company]}</Pill>} <Pill tone="info">v{v?.version_no}</Pill> {t.archived && <Pill>Gearchiveerd</Pill>}</summary>
                {t.description && <p className="small muted">{t.description}</p>}
                {v && <Preview c={v.content} />}
                <p className="small muted">Versies: {t.template_version.slice().sort((a, b) => b.version_no - a.version_no).map((x) => `v${x.version_no} (${datumTijd(x.created_at)})`).join(' · ')}</p>
                {mayEdit && v && (
                  <div className="row">
                    <button onClick={() => setEditing({ id: t.id, name: t.name, company: t.company ?? '', description: t.description ?? '', content: structuredClone(v.content) })}>Bewerken (nieuwe versie)</button>
                    <button onClick={() => setEditing({ id: null, name: `${t.name} (kopie)`, company: t.company ?? '', description: t.description ?? '', content: structuredClone(v.content) })}>Kopiëren</button>
                    <button onClick={async () => { const { error } = await supabase.rpc('set_template_archived', { p_template: t.id, p_archived: !t.archived }); setMsg(error ? { kind: 'error', text: errText(error) } : null); await reload(); }}>{t.archived ? 'Terugzetten' : 'Archiveren'}</button>
                  </div>
                )}
              </details>
            );
          })}
          {mayEdit && (
            <div className="card">
              <h2>Project als template opslaan</h2>
              <div className="row">
                <select aria-label="Project" value={fromProject} onChange={(e) => setFromProject(e.target.value)} style={{ maxWidth: 320 }}>
                  <option value="">Kies project…</option>{data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button disabled={!fromProject} onClick={loadFromProject}>Overnemen in editor</button>
              </div>
              <p className="hint">Taken met een anker houden hun relatieve termijn. Taken zonder anker krijgen geen deadline.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Preview({ c }: { c: Content }) {
  return (
    <div className="small">
      <p><strong>Draaidagen:</strong> {c.no_shoot ? 'geen opnames' : c.shoot_days.map((s) => `${s.title} (D+${s.offset_days})`).join(', ') || '—'}</p>
      <p><strong>Deliverables:</strong> {c.deliverables.map((d) => `${d.title}${d.aspect_ratio ? ` ${d.aspect_ratio}` : ''}${d.feedback_rounds != null ? `, ${d.feedback_rounds} rondes` : ''}${d.group ? ` [${d.group}]` : ''}`).join(' · ') || '—'}</p>
      <p><strong>Freelancers betaald:</strong> {c.freelancers_betaald === false ? 'geldt niet' : 'geldt'}</p>
      {['pre_productie', 'productie', 'post_productie', 'afronding', undefined].map((ph) => {
        const ts = c.tasks.filter((t) => t.phase === ph);
        if (!ts.length) return null;
        return (
          <div key={ph ?? 'x'}><strong>{ph ? phaseLabel[ph] : 'Overig'}:</strong>
            <ul style={{ margin: '4px 0 8px' }}>{ts.map((t, i) => <li key={i}>{t.title}{t.per_deliverable ? ' (per deliverable)' : ''}{t.anchor ? ` · ${t.anchor}${(t.offset ?? 0) >= 0 ? '+' : ''}${t.offset} ${t.calendar ? 'kalenderdagen' : 'werkdagen'}` : ''}{t.subtasks?.length ? ` · subtaken: ${t.subtasks.map((s) => s.title).join(', ')}` : ''}</li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}

function Editor({ value, onChange, onSave, onCancel }: {
  value: { id: string | null; name: string; company: string; description: string; content: Content };
  onChange: (v: typeof value) => void; onSave: () => void; onCancel: () => void;
}) {
  const c = value.content;
  const setC = (patch: Partial<Content>) => onChange({ ...value, content: { ...c, ...patch } });
  const upd = <T,>(arr: T[], i: number, patch: Partial<T>) => arr.map((x, n) => (n === i ? { ...x, ...patch } : x));
  return (
    <div className="card">
      <h2>{value.id ? 'Template bewerken (wordt een nieuwe versie)' : 'Nieuwe template'}</h2>
      <div className="grid2">
        <Field id="tn" label="Naam"><input id="tn" required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></Field>
        <Field id="tc" label="Bedrijf (optioneel)">
          <select id="tc" value={value.company} onChange={(e) => onChange({ ...value, company: e.target.value })}>
            <option value="">Beide</option>{Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field id="td" label="Omschrijving"><input id="td" value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} /></Field>
      </div>
      <div className="row">
        <label className="inline"><input type="checkbox" checked={c.freelancers_betaald !== false} onChange={(e) => setC({ freelancers_betaald: e.target.checked })} /> Mijlpaal "freelancers betaald" geldt</label>
        <label className="inline"><input type="checkbox" checked={!!c.no_shoot} onChange={(e) => setC({ no_shoot: e.target.checked })} /> Geen opnames</label>
      </div>

      <h3>Draaidagen (t.o.v. eerste draaidag, kalenderdagen)</h3>
      {c.shoot_days.map((s, i) => (
        <div key={i} className="row">
          <input aria-label="Titel draaidag" value={s.title} onChange={(e) => setC({ shoot_days: upd(c.shoot_days, i, { title: e.target.value }) })} style={{ maxWidth: 220 }} />
          <label className="inline">D+<input type="number" aria-label="Dagen na eerste draaidag" value={s.offset_days} onChange={(e) => setC({ shoot_days: upd(c.shoot_days, i, { offset_days: Number(e.target.value) }) })} style={{ width: 80 }} /></label>
          <button className="link" onClick={() => setC({ shoot_days: c.shoot_days.filter((_, n) => n !== i) })}>verwijderen</button>
        </div>
      ))}
      <button onClick={() => setC({ shoot_days: [...c.shoot_days, { title: `Draaidag ${c.shoot_days.length + 1}`, offset_days: c.shoot_days.length }] })}>+ Draaidag</button>

      <h3>Deliverables</h3>
      {c.deliverables.map((d, i) => (
        <div key={i} className="row">
          <input aria-label="Titel" placeholder="Titel" value={d.title} onChange={(e) => setC({ deliverables: upd(c.deliverables, i, { title: e.target.value }) })} style={{ maxWidth: 200 }} />
          <input aria-label="Beeldverhouding" placeholder="16:9" value={d.aspect_ratio ?? ''} onChange={(e) => setC({ deliverables: upd(c.deliverables, i, { aspect_ratio: e.target.value || undefined }) })} style={{ maxWidth: 90 }} />
          <input aria-label="Feedbackrondes" type="number" placeholder="rondes" value={d.feedback_rounds ?? ''} onChange={(e) => setC({ deliverables: upd(c.deliverables, i, { feedback_rounds: e.target.value === '' ? undefined : Number(e.target.value) }) })} style={{ maxWidth: 90 }} />
          <input aria-label="Groep" placeholder="groep" value={d.group ?? ''} onChange={(e) => setC({ deliverables: upd(c.deliverables, i, { group: e.target.value || undefined }) })} style={{ maxWidth: 150 }} />
          <button className="link" onClick={() => setC({ deliverables: c.deliverables.filter((_, n) => n !== i) })}>verwijderen</button>
        </div>
      ))}
      <button onClick={() => setC({ deliverables: [...c.deliverables, { title: '' }] })}>+ Deliverable</button>

      <h3>Taken</h3>
      <p className="hint">Anker S = projectstart, D = eerste draaidag, L = laatste draaidag. Termijnen in werkdagen; vinkje "kalender" voor kalenderdagen.</p>
      {c.tasks.map((t, i) => (
        <div key={i} className="row" style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
          <input aria-label="Titel taak" placeholder="Titel" value={t.title} onChange={(e) => setC({ tasks: upd(c.tasks, i, { title: e.target.value }) })} style={{ maxWidth: 240 }} />
          <select aria-label="Fase" value={t.phase ?? ''} onChange={(e) => setC({ tasks: upd(c.tasks, i, { phase: e.target.value || undefined }) })} style={{ maxWidth: 150 }}>
            <option value="">Overig</option>{['pre_productie', 'productie', 'post_productie', 'afronding'].map((p) => <option key={p} value={p}>{phaseLabel[p]}</option>)}
          </select>
          <select aria-label="Anker" value={t.anchor ?? ''} onChange={(e) => setC({ tasks: upd(c.tasks, i, { anchor: e.target.value || undefined, offset: e.target.value ? t.offset ?? 0 : undefined }) })} style={{ maxWidth: 170 }}>
            <option value="">Geen deadline</option>{Object.entries(anchorLabel).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
          {t.anchor && <input aria-label="Termijn" type="number" value={t.offset ?? 0} onChange={(e) => setC({ tasks: upd(c.tasks, i, { offset: Number(e.target.value) }) })} style={{ width: 80 }} />}
          {t.anchor && <label className="inline"><input type="checkbox" checked={!!t.calendar} onChange={(e) => setC({ tasks: upd(c.tasks, i, { calendar: e.target.checked || undefined }) })} /> kalender</label>}
          <label className="inline"><input type="checkbox" checked={!!t.per_deliverable} onChange={(e) => setC({ tasks: upd(c.tasks, i, { per_deliverable: e.target.checked || undefined }) })} /> per deliverable</label>
          <input aria-label="Subtaken" placeholder="subtaken, komma-gescheiden" value={(t.subtasks ?? []).map((s) => s.title).join(', ')}
            onChange={(e) => setC({ tasks: upd(c.tasks, i, { subtasks: e.target.value ? e.target.value.split(',').map((x) => ({ title: x.trim() })).filter((x) => x.title) : undefined }) })} style={{ maxWidth: 240 }} />
          <button className="link" onClick={() => setC({ tasks: c.tasks.filter((_, n) => n !== i) })}>verwijderen</button>
        </div>
      ))}
      <button onClick={() => setC({ tasks: [...c.tasks, { title: '' }] })}>+ Taak</button>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" disabled={!value.name.trim()} onClick={onSave}>Opslaan als nieuwe versie</button>
        <button onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}
