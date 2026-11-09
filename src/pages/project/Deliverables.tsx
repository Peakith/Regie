import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { assignmentStatusLabel, datum, datumTijd, deliverableManualStatuses, deliverableStatusLabel, isVerlopen, vandaag, versionStatusLabel } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import Opmerkingen from '../../components/Opmerkingen';
import type { TabProps } from './types';

type Version = { id: string; version_no: number; file_ref: string | null; note: string | null; created_at: string; status: string; feedback_round: number | null; submitted_at: string };
type Approval = { id: string; version_id: string; approved_by_name: string; approved_at: string; evidence: string; source: string; registered_at: string; revoked_at: string | null; revoked_reason: string | null };
type Assign = { id: string; person_id: string; status: string; role_label: string; person: { full_name: string } };
type Deliv = {
  id: string; project_id: string; parent_id: string | null; title: string; kind: string | null; format: string | null; aspect_ratio: string | null;
  duration_text: string | null; language: string | null; channel: string | null; deadline: string | null; status: string;
  status_reason: string | null; scope: string; required_version_id: string | null; feedback_rounds_agreed: number | null;
  delivered_at: string | null; revision: number; group_label: string | null; responsible_person_id: string | null;
  is_extra_work: boolean; extra_work_note: string | null; final_link: string | null;
  deliverable_version: Version[]; approval: Approval[]; assignment: Assign[];
};

const tone = (s: string) => (s === 'geleverd' || s === 'goedgekeurd' ? 'ok' : s === 'wijzigingen_nodig' ? 'warn' : s === 'in_review' ? 'info' : undefined);

export default function Deliverables(props: TabProps) {
  const { project, canEdit } = props;
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from('deliverable')
      .select('*, deliverable_version!deliverable_version_deliverable_id_fkey(*), approval(*), assignment(id,person_id,status,role_label,person(full_name))')
      .eq('project_id', project.id).order('sort').order('created_at')) as Deliv[], [project.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ title: '', kind: '', deadline: '', parent: '', group: '', ratio: '', rounds: '' });
  const [err, setErr] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const { error } = await supabase.from('deliverable').insert({
      project_id: project.id, title: f.title, kind: f.kind || null, deadline: f.deadline || null,
      parent_id: f.parent || null, sort: (data?.length ?? 0), group_label: f.group || null, aspect_ratio: f.ratio || null,
      feedback_rounds_agreed: f.rounds ? Number(f.rounds) : null,
    });
    if (error) return setErr(errText(error));
    setF({ title: '', kind: '', deadline: '', parent: '', group: f.group, ratio: '', rounds: '' });
    await reload();
  }

  if (loading && !data) return <Loading />;
  const list = data ?? [];
  return (
    <>
      <Msg>{error}</Msg>
      {list.length === 0 && <div className="card muted">Nog geen deliverables. Leg iedere concrete output apart vast (bijv. Hero 1, Social 1–4), zodat editor, versie en akkoord per output te volgen zijn.</div>}
      {[...new Set(list.map((d) => d.group_label ?? ''))].map((g) => (
        <div key={g}>
          {g && <h3 style={{ marginTop: 12 }}>Groep: {g} <span className="small muted">({list.filter((d) => d.group_label === g && d.status === 'geleverd').length}/{list.filter((d) => d.group_label === g && d.status !== 'vervallen').length} opgeleverd)</span></h3>}
          {list.filter((d) => (d.group_label ?? '') === g).map((d) => (
            <DeliverableItem key={d.id} d={d} all={list} open={open === d.id} toggle={() => setOpen(open === d.id ? null : d.id)} reload={reload} {...props} />
          ))}
        </div>
      ))}
      {canEdit && (
        <form className="card" onSubmit={add}>
          <h2>Deliverable toevoegen</h2>
          <div className="grid2">
            <Field id="dt" label="Titel"><input id="dt" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bijv. Social 1 – 9:16" /></Field>
            <Field id="dk" label="Soort"><input id="dk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="hero, social, aftermovie…" /></Field>
            <Field id="dd" label="Deadline"><input id="dd" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
            <Field id="dr" label="Beeldverhouding"><input id="dr" value={f.ratio} onChange={(e) => setF({ ...f, ratio: e.target.value })} placeholder="16:9, 9:16, 1:1…" /></Field>
            <Field id="dfr" label="Afgesproken feedbackrondes"><input id="dfr" type="number" min={0} value={f.rounds} onChange={(e) => setF({ ...f, rounds: e.target.value })} /></Field>
            <Field id="dg" label="Groep (optioneel)" hint="Bijv. Socialpakket; elke variant blijft een eigen deliverable."><input id="dg" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} /></Field>
            <Field id="dp" label="Variant van (optioneel)">
              <select id="dp" value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}>
                <option value="">Geen, zelfstandig product</option>
                {list.filter((x) => !x.parent_id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            </Field>
          </div>
          <Msg>{err}</Msg>
          <button className="primary">Toevoegen</button>
        </form>
      )}
    </>
  );
}

function DeliverableItem({ d, all, open, toggle, reload, canEdit, canManage, canApprove, people, project }: TabProps & { d: Deliv; all: Deliv[]; open: boolean; toggle: () => void; reload: () => Promise<void> }) {
  const [err, setErr] = useState('');
  const versions = [...d.deliverable_version].sort((a, b) => b.version_no - a.version_no);
  const required = versions.find((v) => v.id === d.required_version_id);
  const editors = d.assignment.filter((a) => ['optie', 'bevestigd'].includes(a.status));
  const parent = all.find((x) => x.id === d.parent_id);
  const validApprovalOnRequired = d.approval.find((a) => a.version_id === d.required_version_id && !a.revoked_at);
  const latestRound = versions[0]?.feedback_round ?? 0;
  const meerwerk = d.feedback_rounds_agreed != null && latestRound > d.feedback_rounds_agreed;
  const responsible = people.find((p) => p.id === d.responsible_person_id)?.full_name;

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setErr('');
    const { error } = await fn();
    if (error) setErr(errText(error));
    await reload();
  }

  async function setStatus(status: string) {
    let reason: string | null = d.status_reason;
    if (status === 'vervallen') {
      reason = prompt('Waarom vervalt deze deliverable? (verplicht)');
      if (!reason?.trim()) return;
    }
    await run(() => supabase.from('deliverable').update({ status, status_reason: reason }).eq('id', d.id).eq('revision', d.revision).select().then((r) => ({ error: r.error ?? (r.data?.length ? null : { message: 'Iemand anders heeft deze deliverable intussen gewijzigd. Bekijk de nieuwste stand en probeer opnieuw.' }) })));
  }

  return (
    <div className={`item ${open ? 'open' : ''}`}>
      <div className="row between">
        <div>
          <button className="link" style={{ color: 'var(--text)', fontWeight: 700, textDecoration: 'none', fontSize: 15 }} onClick={toggle} aria-expanded={open}>
            {open ? '▾' : '▸'} {d.title}
          </button>
          {parent && <span className="small muted"> · variant van {parent.title}</span>}
          <div className="small muted" style={{ marginTop: 4 }}>
            Editor: {editors.length ? editors.map((a) => `${a.person.full_name} (${assignmentStatusLabel[a.status].toLowerCase()})`).join(', ') : <Pill tone="warn">Geen editor</Pill>}
            {' · '}Deadline: {isVerlopen(d.deadline) && !['geleverd', 'vervallen'].includes(d.status) ? <Pill tone="danger">{datum(d.deadline)}</Pill> : datum(d.deadline)}
            {' · '}Versie: {required ? `v${required.version_no} (${versionStatusLabel[required.status]})` : versions.length ? `v${versions[0].version_no} (laatste)` : 'nog geen'}
            {d.feedback_rounds_agreed != null && <> · Ronde {latestRound}/{d.feedback_rounds_agreed}</>}
            {responsible && <> · Verantwoordelijke: {responsible}</>}
          </div>
        </div>
        <div className="row">
          {d.scope !== 'overeengekomen' && <Pill tone="warn">Scope: {d.scope}</Pill>}
          {meerwerk && !d.is_extra_work && <Pill tone="warn">Mogelijk meerwerk</Pill>}
          {d.is_extra_work && <Pill tone="warn">Meerwerk</Pill>}
          <Pill tone={tone(d.status)}>{deliverableStatusLabel[d.status]}</Pill>
        </div>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          <Msg>{err}</Msg>
          {d.status === 'vervallen' && <Msg kind="info">Vervallen: {d.status_reason}</Msg>}
          {canEdit && !['goedgekeurd', 'geleverd'].includes(d.status) && (
            <div className="row">
              <label htmlFor={`st-${d.id}`} style={{ margin: 0 }}>Status</label>
              <select id={`st-${d.id}`} style={{ maxWidth: 220 }} value={d.status} onChange={(e) => setStatus(e.target.value)}>
                {deliverableManualStatuses.map((s) => <option key={s} value={s}>{deliverableStatusLabel[s]}</option>)}
              </select>
              <span className="hint">Goedgekeurd en Geleverd gaan via akkoord en levering hieronder.</span>
            </div>
          )}
          {meerwerk && !d.is_extra_work && canApprove && (
            <Msg kind="warn">
              Feedbackronde {latestRound} terwijl er {d.feedback_rounds_agreed} zijn afgesproken. Dit is een signaal; of het meerwerk is, beslis jij.{' '}
              <button onClick={async () => {
                const note = prompt('Omschrijving meerwerk (wordt een besluit in het project)');
                if (!note?.trim()) return;
                await run(async () => {
                  const r1 = await supabase.from('deliverable').update({ is_extra_work: true, extra_work_note: note }).eq('id', d.id).select();
                  if (r1.error) return r1;
                  return supabase.rpc('record_decision', { p_project: project.id, p_kind: 'meerwerk', p_subject: `Meerwerk: ${d.title}`, p_taken_by: null, p_decided_on: vandaag(), p_evidence: note, p_deliverable: d.id });
                });
              }}>Markeer als meerwerk</button>
            </Msg>
          )}
          <Specs d={d} canEdit={canEdit} reload={reload} people={people} />

          <h3>Editors</h3>
          <EditorAssign d={d} people={people} canEdit={canEdit} reload={reload} />

          <h3>Versies en akkoord</h3>
          {versions.length === 0 && <p className="muted small">Nog geen versies. Een bestand of link toevoegen is geen klantakkoord.</p>}
          {versions.map((v) => {
            const apps = d.approval.filter((a) => a.version_id === v.id);
            return (
              <div key={v.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
                <div className="row between">
                  <div>
                    <strong>v{v.version_no}</strong> <Pill tone={v.status === 'goedgekeurd' ? 'ok' : v.status === 'feedback_ontvangen' ? 'warn' : v.status === 'vervangen' ? undefined : 'info'}>{versionStatusLabel[v.status]}</Pill>
                    {v.id === d.required_version_id && <> <Pill>Actuele versie</Pill></>}
                    <div className="small muted">
                      {v.file_ref ? (/^https?:\/\//.test(v.file_ref) ? <a href={v.file_ref} target="_blank" rel="noreferrer">{v.file_ref}</a> : v.file_ref) : 'Geen link'}
                      {v.note ? ` · ${v.note}` : ''} · ronde {v.feedback_round ?? '—'} · {datumTijd(v.submitted_at ?? v.created_at)}
                    </div>
                  </div>
                  {canEdit && v.status === 'in_review' && (
                    <button onClick={() => run(() => supabase.rpc('set_version_status', { p_version: v.id, p_status: 'feedback_ontvangen' }))}>Feedback ontvangen</button>
                  )}
                  {canManage && v.id !== d.required_version_id && !['vervallen'].includes(d.status) && !['goedgekeurd', 'vervangen'].includes(v.status) && (
                    <button onClick={() => { if (confirm(`v${v.version_no} de vereiste opleverversie maken? Een akkoord op een andere versie geldt dan niet meer voor de oplevering.`)) void run(() => supabase.rpc('set_required_version', { p_deliverable: d.id, p_version: v.id })); }}>
                      Maak vereiste versie
                    </button>
                  )}
                </div>
                {apps.map((a) => (
                  <div key={a.id} className="small" style={{ marginTop: 6 }}>
                    {a.revoked_at ? <Pill>Ingetrokken</Pill> : <Pill tone="ok">Akkoord</Pill>}{' '}
                    door {a.approved_by_name} op {datumTijd(a.approved_at)} · bewijs: {a.evidence}
                    <span className="muted"> · {a.source === 'reviewtool' ? 'uit de reviewtool' : 'vastgelegd door medewerker'} {datumTijd(a.registered_at)}</span>
                    {a.revoked_at && <span className="muted"> · ingetrokken: {a.revoked_reason}</span>}
                    {canManage && !a.revoked_at && (
                      <> · <button className="link" onClick={() => { const r = prompt('Reden voor intrekken (verplicht)'); if (r?.trim()) void run(() => supabase.rpc('revoke_approval', { p_approval: a.id, p_reason: r })); }}>intrekken</button></>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {canEdit && d.status !== 'vervallen' && d.status !== 'geleverd' && <AddVersion d={d} reload={reload} />}
          {canApprove && versions.length > 0 && !['vervallen', 'geleverd', 'goedgekeurd'].includes(d.status) && (
            <RegisterApproval version={required ?? versions[0]} isLatest={(required ?? versions[0]).id === versions[0].id} reload={reload} />
          )}
          {canApprove && d.status === 'goedgekeurd' && validApprovalOnRequired && (
            <button className="primary" onClick={() => run(() => supabase.rpc('mark_delivered', { p_deliverable: d.id }))}>Markeer als opgeleverd</button>
          )}
          {d.status === 'geleverd' && <Msg kind="ok">Opgeleverd op {datumTijd(d.delivered_at)} (v{required?.version_no}).{d.final_link && <> <a href={d.final_link} target="_blank" rel="noreferrer">Definitieve versie</a></>}</Msg>}
          <h3>Opmerkingen</h3>
          <Opmerkingen projectId={project.id} subjectType="deliverable" subjectId={d.id} canEdit={canEdit} />
          {canManage && (
            <div><button className="danger" onClick={() => { if (confirm(`"${d.title}" naar de prullenbak? Herstellen kan 30 dagen.`)) void run(() => supabase.rpc('soft_delete', { p_kind: 'deliverable', p_id: d.id })); }}>Verwijderen</button></div>
          )}
        </div>
      )}
    </div>
  );
}

function Specs({ d, canEdit, reload, people }: { d: Deliv; canEdit: boolean; reload: () => Promise<void>; people: TabProps['people'] }) {
  const [f, setF] = useState({
    group: d.group_label ?? '', responsible: d.responsible_person_id ?? '', final: d.final_link ?? '',
    title: d.title, format: d.format ?? '', aspect_ratio: d.aspect_ratio ?? '', duration_text: d.duration_text ?? '',
    language: d.language ?? '', channel: d.channel ?? '', deadline: d.deadline ?? '', feedback: d.feedback_rounds_agreed?.toString() ?? '',
    scope: d.scope,
  });
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok' | 'warn'; text: string } | null>(null);
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <Field id={`${k}-${d.id}`} label={label}><input id={`${k}-${d.id}`} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from('deliverable').update({
      title: f.title, format: f.format || null, aspect_ratio: f.aspect_ratio || null, duration_text: f.duration_text || null,
      language: f.language || null, channel: f.channel || null, deadline: f.deadline || null,
      feedback_rounds_agreed: f.feedback ? Number(f.feedback) : null, scope: f.scope,
      group_label: f.group || null, responsible_person_id: f.responsible || null, final_link: f.final || null,
    }).eq('id', d.id).eq('revision', d.revision).select('id');
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    if (!data?.length) return setMsg({ kind: 'warn', text: 'Iemand anders heeft deze deliverable intussen gewijzigd. Je wijzigingen staan nog in het formulier; laad opnieuw om de nieuwste stand te zien.' });
    setMsg({ kind: 'ok', text: 'Opgeslagen.' });
    await reload();
  }
  return (
    <form onSubmit={save}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          {field('title', 'Titel')}
          {field('format', 'Formaat')}
          {field('aspect_ratio', 'Beeldverhouding')}
          {field('duration_text', 'Lengte')}
          {field('language', 'Taal')}
          {field('channel', 'Kanaal')}
          {field('deadline', 'Deadline', 'date')}
          {field('feedback', 'Afgesproken feedbackrondes', 'number')}
          {field('group', 'Groep')}
          {field('final', 'Definitieve link (oplevering)')}
          <Field id={`rp-${d.id}`} label="Verantwoordelijke">
            <select id={`rp-${d.id}`} value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })}>
              <option value="">Projectverantwoordelijke</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field id={`sc-${d.id}`} label="Scope">
            <select id={`sc-${d.id}`} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="overeengekomen">Overeengekomen</option>
              <option value="voorgesteld">Voorgesteld (meerwerk, nog niet akkoord)</option>
              <option value="afgewezen">Afgewezen</option>
            </select>
          </Field>
        </div>
        <p className="hint">Onbekende waarden laat je leeg. Alle niet-geannuleerde deliverables moeten zijn opgeleverd voordat het project naar Afronding gaat.</p>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        {canEdit && <button>Specificaties opslaan</button>}
      </fieldset>
    </form>
  );
}

function EditorAssign({ d, people, canEdit, reload }: { d: Deliv; people: TabProps['people']; canEdit: boolean; reload: () => Promise<void> }) {
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState('optie');
  const [err, setErr] = useState('');
  const active = d.assignment;
  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('assignment').insert({ project_id: d.project_id, person_id: person, deliverable_id: d.id, role_label: 'editor', status });
    if (error) return setErr(errText(error));
    setPerson('');
    await reload();
  }
  async function update(a: Assign, s: string) {
    const { error } = await supabase.from('assignment').update({ status: s }).eq('id', a.id);
    if (error) setErr(errText(error));
    await reload();
  }
  const editorsFirst = [...people].sort((a, b) => Number(b.roles.includes('editor')) - Number(a.roles.includes('editor')));
  return (
    <div className="stack">
      {active.length === 0 && <p className="small muted">Nog geen editor toegewezen.</p>}
      {active.map((a) => (
        <div key={a.id} className="row">
          <span>{a.person.full_name}</span>
          {canEdit ? (
            <select aria-label={`Status ${a.person.full_name}`} value={a.status} onChange={(e) => update(a, e.target.value)} style={{ maxWidth: 160 }}>
              {Object.entries(assignmentStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          ) : <Pill>{assignmentStatusLabel[a.status]}</Pill>}
        </div>
      ))}
      {canEdit && (
        <form className="row" onSubmit={add}>
          <select aria-label="Editor kiezen" required value={person} onChange={(e) => setPerson(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">Kies editor…</option>
            {editorsFirst.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.roles.includes('editor') ? ' (editor)' : ''}</option>)}
          </select>
          <select aria-label="Optie of bevestigd" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="optie">Optie</option><option value="bevestigd">Bevestigd</option>
          </select>
          <button>Toewijzen</button>
        </form>
      )}
      <Msg>{err}</Msg>
    </div>
  );
}

function AddVersion({ d, reload }: { d: Deliv; reload: () => Promise<void> }) {
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('add_version', { p_deliverable: d.id, p_file_ref: ref, p_note: note || null });
    if (error) return setErr(errText(error));
    setRef(''); setNote('');
    await reload();
  }
  return (
    <form onSubmit={add} className="row">
      <input aria-label="Link naar versie" placeholder="Link naar bestand of review (bijv. reviewtool of Dropbox)" value={ref} onChange={(e) => setRef(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
      <input aria-label="Notitie bij versie" placeholder="Notitie" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
      <button>Nieuwe versie</button>
      <Msg>{err}</Msg>
    </form>
  );
}

function RegisterApproval({ version, isLatest, reload }: { version: Version; isLatest: boolean; reload: () => Promise<void> }) {
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: '', date: vandaag(), evidence: '' });
  const [err, setErr] = useState('');
  if (!show) return <button onClick={() => setShow(true)}>Goedkeuring vastleggen op v{version.version_no}</button>;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('register_approval', {
      p_version: version.id, p_approved_by_name: f.name, p_approved_at: new Date(`${f.date}T12:00:00`).toISOString(), p_evidence: f.evidence,
    });
    if (error) return setErr(errText(error));
    setShow(false);
    await reload();
  }
  return (
    <form className="card" onSubmit={submit} style={{ padding: 12 }}>
      <h3>Goedkeuring vastleggen op v{version.version_no}</h3>
      {!isLatest && <Msg kind="warn">Er is een nieuwere versie dan de vereiste versie. Maak eerst de juiste versie vereist.</Msg>}
      <p className="hint">Dit wordt een onveranderlijk besluit, met jouw naam en tijdstip. De goedkeuring geldt alleen voor v{version.version_no}; een latere versie wordt nooit automatisch goedgekeurd.</p>
      <div className="grid2">
        <Field id="an" label="Akkoord gegeven door"><input id="an" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Naam contactpersoon klant" /></Field>
        <Field id="ad" label="Datum akkoord"><input id="ad" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <Field id="ae" label="Bewijs" hint="Bijv. 'mail van 12-11, 14:03' of een link naar het bericht.">
        <input id="ae" required value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
      </Field>
      <Msg>{err}</Msg>
      <div className="row"><button className="primary">Goedkeuring vastleggen</button><button type="button" onClick={() => setShow(false)}>Annuleren</button></div>
    </form>
  );
}
