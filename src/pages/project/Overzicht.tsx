import { useEffect, useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { isManager, isOwnerOrAdmin, useCtx } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';
import { dagKort, datumTijd, financeMilestones, isVerlopen, lifecycleLabel, milestoneLabel, phaseLabel, phaseOrder, versionStatusLabel } from '../../lib/labels';
import { Field, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type Milestone = { id: string; kind: string; applicable: boolean; checked_at: string | null; checked_by: string | null; note: string | null };

export default function Overzicht(props: TabProps & { goTab: (t: string) => void }) {
  const { project, status, canManage, canEdit, canApprove, reloadProject, goTab } = props;
  const ctx = useCtx();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn' | 'info'; text: string } | null>(null);
  const { data, reload } = useLoad(async () => {
    const [ms, shoots, review, tasks, members] = await Promise.all([
      supabase.from('milestone').select('*').eq('project_id', project.id),
      supabase.from('shoot_day').select('id,date,start_time,location,status').eq('project_id', project.id).neq('status', 'geannuleerd')
        .gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(1),
      supabase.from('deliverable').select('id,title,required_version_id,deliverable_version!deliverable_version_deliverable_id_fkey(id,version_no,status,submitted_at)')
        .eq('project_id', project.id).eq('status', 'in_review'),
      supabase.from('task').select('id,title,deadline,status,assignee_person_id').eq('project_id', project.id)
        .not('status', 'in', '(klaar,vervallen)').order('deadline', { ascending: true, nullsFirst: false }).limit(6),
      isOwnerOrAdmin(ctx.role) ? supabase.rpc('list_members', { p_ws: ctx.workspace_id }) : Promise.resolve({ data: [], error: null }),
    ]);
    return {
      milestones: must(ms) as Milestone[], nextShoot: (must(shoots) as { id: string; date: string; start_time: string | null; location: string | null; status: string }[])[0],
      review: must(review) as { id: string; title: string; required_version_id: string; deliverable_version: { id: string; version_no: number; status: string; submitted_at: string }[] }[],
      tasks: must(tasks) as { id: string; title: string; deadline: string | null; status: string; assignee_person_id: string | null }[],
      members: (must(members) ?? []) as { user_id: string; person_name: string | null; email: string }[],
    };
  }, [project.id, project.revision, status.phase]);

  async function act(fn: () => PromiseLike<{ error: unknown; data?: unknown }>, ok: string) {
    setMsg(null);
    const { error } = await fn();
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: ok });
    await reloadProject(); await reload();
  }
  const who = (uid: string | null) => data?.members.find((m) => m.user_id === uid)?.person_name ?? (uid ? 'medewerker' : '');

  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {project.is_concept && <Concept {...props} onDone={(t) => { setMsg({ kind: 'ok', text: t }); }} />}

      <div className="dash" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Fase: {phaseLabel[status.phase]}</h2>
          <p className="small muted">{status.phase_mode === 'handmatig' ? `Handmatig gezet. ${status.phase_reason ?? ''}` : status.phase_reason ?? 'Automatisch berekend.'}</p>
          {status.phase_mode === 'handmatig' && status.phase_suggested !== status.phase && (
            <Msg kind="warn">De automatiek zou nu "{phaseLabel[status.phase_suggested]}" kiezen ({status.auto_reason}).</Msg>
          )}
          {status.waiting.length > 0 && status.phase !== 'administratief_klaar' && (
            <>
              <h3>Nodig voor de volgende fase</h3>
              <ul className="plain">{status.waiting.map((w) => <li key={w} className="small">{w}</li>)}</ul>
            </>
          )}
          {status.operational_done_at && <p className="small">Operationeel klaar: {datumTijd(status.operational_done_at)}</p>}
          {status.admin_done_at && <p className="small">Administratief klaar: {datumTijd(status.admin_done_at)}</p>}
          {canManage && <PhaseControl {...props} onMsg={setMsg} />}
        </section>

        <section className="card">
          <h2>Open blokkades</h2>
          <ul className="plain">
            {status.blockers.map((b, i) => (
              <li key={i}><Pill tone={b.type === 'dubbel' ? 'warn' : 'danger'}>{b.type === 'backup' ? 'Back-up' : b.type === 'apparatuur' ? 'Apparatuur' : 'Dubbel'}</Pill>{' '}
                <button className="link" onClick={() => goTab('Draaidagen')}>{b.text}</button></li>
            ))}
            {status.blockers.length === 0 && <li className="muted small">Geen blokkades.</li>}
          </ul>
          {status.risk_reasons.length > 0 && (<><h3>Planningsrisico</h3><ul className="plain">{status.risk_reasons.map((r) => <li key={r} className="small">{r}</li>)}</ul></>)}
        </section>

        <section className="card">
          <h2>Eerstvolgend</h2>
          <p className="small">
            <strong>Draaidag:</strong>{' '}
            {data?.nextShoot ? <button className="link" onClick={() => goTab('Draaidagen')}>{dagKort(data.nextShoot.date)} {data.nextShoot.start_time?.slice(0, 5) ?? ''} {data.nextShoot.location ?? ''} ({data.nextShoot.status})</button> : 'geen gepland'}
          </p>
          <h3>Versies in review</h3>
          <ul className="plain">
            {data?.review.map((d) => {
              const v = d.deliverable_version.find((x) => x.id === d.required_version_id);
              return <li key={d.id} className="small"><button className="link" onClick={() => goTab('Deliverables')}>{d.title} v{v?.version_no}</button> · {v ? versionStatusLabel[v.status] : ''} sinds {dagKort(v?.submitted_at)}</li>;
            })}
            {data?.review.length === 0 && <li className="small muted">Niets in review.</li>}
          </ul>
          <h3>Volgende acties</h3>
          <ul className="plain">
            {data?.tasks.map((t) => (
              <li key={t.id} className="small"><button className="link" onClick={() => goTab('Taken')}>{t.title}</button>
                {t.deadline && <> · {isVerlopen(t.deadline) ? <Pill tone="danger">{dagKort(t.deadline)}</Pill> : dagKort(t.deadline)}</>}
                {t.assignee_person_id && <span className="muted"> · {props.people.find((p) => p.id === t.assignee_person_id)?.full_name}</span>}</li>
            ))}
            {data?.tasks.length === 0 && <li className="small muted">Geen open taken.</li>}
          </ul>
        </section>

        <section className="card">
          <h2>Mijlpalen</h2>
          <ul className="plain">
            {(data?.milestones ?? []).sort((a, b) => Object.keys(milestoneLabel).indexOf(a.kind) - Object.keys(milestoneLabel).indexOf(b.kind)).map((m) => {
              const fin = financeMilestones.includes(m.kind);
              const may = fin ? canManage : canApprove;
              return (
                <li key={m.id}>
                  <label className="inline">
                    <input type="checkbox" disabled={!may || !m.applicable} checked={!!m.checked_at}
                      onChange={(e) => act(() => supabase.rpc('set_milestone', { p_project: project.id, p_kind: m.kind, p_checked: e.target.checked }),
                        `${milestoneLabel[m.kind]} ${e.target.checked ? 'afgevinkt' : 'teruggezet'}.`)} />
                    {milestoneLabel[m.kind]}
                  </label>
                  {!m.applicable && <Pill>Niet van toepassing</Pill>}
                  {m.checked_at && <div className="small muted">{datumTijd(m.checked_at)}{who(m.checked_by) ? ` · ${who(m.checked_by)}` : ''}{m.note ? ` · ${m.note}` : ''}</div>}
                  {canManage && m.kind === 'freelancers_betaald' && (
                    <button className="link small" onClick={() => act(() => supabase.rpc('set_milestone', { p_project: project.id, p_kind: m.kind, p_checked: !!m.checked_at, p_applicable: !m.applicable }), 'Aangepast.')}>
                      {m.applicable ? 'Geen freelancers in dit project' : 'Geldt wel'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {!isManager(ctx.role) && <p className="hint">Financiële mijlpalen zijn alleen zichtbaar voor eigenaar, admin en projectmanager.</p>}
        </section>
      </div>

      <Kerngegevens {...props} />
      {(canManage || isManager(ctx.role)) && <Beheer {...props} onMsg={setMsg} canEditAny={canEdit} />}
    </>
  );
}

function PhaseControl({ project, status, reloadProject, onMsg }: TabProps & { onMsg: (m: { kind: 'ok' | 'error' | 'warn' | 'info'; text: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState(status.phase);
  const [reason, setReason] = useState('');
  const [proposal, setProposal] = useState<{ suggested: string; reason: string } | null>(null);
  async function setManual(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('set_phase_manual', { p_project: project.id, p_phase: phase, p_reason: reason });
    onMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Fase handmatig gezet. De automatiek past dit project niet meer aan tot je "Automatiek hervatten" kiest.' });
    if (!error) { setOpen(false); setReason(''); }
    await reloadProject();
  }
  async function resume(confirm: boolean) {
    const { data, error } = await supabase.rpc('resume_auto_phase', { p_project: project.id, p_confirm: confirm });
    if (error) return onMsg({ kind: 'error', text: errText(error) });
    if (!confirm) return setProposal((data as { suggested: string; reason: string }[])[0]);
    setProposal(null);
    onMsg({ kind: 'ok', text: 'Automatiek hervat.' });
    await reloadProject();
  }
  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <div className="row">
        {!open && <button onClick={() => setOpen(true)}>Fase handmatig corrigeren</button>}
        {status.phase_mode === 'handmatig' && !proposal && <button onClick={() => resume(false)}>Automatiek hervatten</button>}
      </div>
      {proposal && (
        <Msg kind="info">
          Voorgestelde fase: <strong>{phaseLabel[proposal.suggested]}</strong> ({proposal.reason}).{' '}
          <button className="primary" onClick={() => resume(true)}>Bevestigen</button> <button onClick={() => setProposal(null)}>Annuleren</button>
        </Msg>
      )}
      {open && (
        <form onSubmit={setManual} className="stack">
          <select aria-label="Fase" value={phase} onChange={(e) => setPhase(e.target.value)}>
            {phaseOrder.map((p) => <option key={p} value={p}>{phaseLabel[p]}</option>)}
          </select>
          <input aria-label="Reden (verplicht)" placeholder="Reden (verplicht, komt in het audit-log)" required value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row"><button className="primary">Fase vastzetten</button><button type="button" onClick={() => setOpen(false)}>Annuleren</button></div>
        </form>
      )}
    </div>
  );
}

function Kerngegevens({ project, canEdit, canManage, people, reloadProject }: TabProps) {
  const initial = () => ({
    name: project.name, manager: project.manager_person_id ?? '', contact: project.contact_person_id ?? '', briefing: project.briefing ?? '',
    agreements: project.agreements ?? '', noShoot: !project.production_applicable, automation: project.automation_enabled,
  });
  const [f, setF] = useState(initial);
  const [base, setBase] = useState(project.revision);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok' | 'warn'; text: string } | null>(null);
  const [conflict, setConflict] = useState<null | Record<string, unknown>>(null);
  useEffect(() => { if (!conflict) { setF(initial()); setBase(project.revision); } }, [project.revision]); // eslint-disable-line

  async function save(revision: number) {
    setMsg(null);
    const values: Record<string, unknown> = {
      name: f.name, manager_person_id: f.manager || null, contact_person_id: f.contact || null, briefing: f.briefing || null,
      agreements: f.agreements || null, production_applicable: !f.noShoot,
    };
    if (canManage) values.automation_enabled = f.automation;
    const { data, error } = await supabase.from('project').update(values).eq('id', project.id).eq('revision', revision).select('revision');
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    if (!data?.length) {
      const { data: theirs } = await supabase.from('project').select('name,briefing,agreements,manager_person_id').eq('id', project.id).single();
      setConflict(theirs ?? {});
      return setMsg({ kind: 'warn', text: 'Iemand anders heeft dit project intussen gewijzigd. Er is niets overschreven. Hieronder zie je beide versies; kies welke je wilt houden.' });
    }
    setConflict(null);
    setMsg({ kind: 'ok', text: 'Opgeslagen.' });
    await reloadProject();
  }
  async function forceSave() {
    const { data } = await supabase.from('project').select('revision').eq('id', project.id).single();
    if (data) await save(data.revision);
  }

  return (
    <div className="card">
      <h2>Projectgegevens</h2>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          <Field id="pn" label="Projectnaam"><input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field id="pm" label="Verantwoordelijke">
            <select id="pm" value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })}>
              <option value="">Nog niet gekozen</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field id="pc" label="Contactpersoon klant">
            <select id="pc" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })}>
              <option value="">Nog niet gekozen</option>
              {people.filter((p) => !p.user_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
        </div>
        <Field id="pb" label="Briefing"><textarea id="pb" rows={5} value={f.briefing} onChange={(e) => setF({ ...f, briefing: e.target.value })} /></Field>
        <Field id="pa" label="Afspraken" hint="Bijv. aantal feedbackrondes en opleverformaten. Prijzen en marges blijven in Bruto.">
          <textarea id="pa" rows={4} value={f.agreements} onChange={(e) => setF({ ...f, agreements: e.target.value })} />
        </Field>
        <div className="field"><label className="inline"><input type="checkbox" checked={f.noShoot} onChange={(e) => setF({ ...f, noShoot: e.target.checked })} /> Geen opnames</label></div>
        {canManage && <div className="field"><label className="inline"><input type="checkbox" checked={f.automation} onChange={(e) => setF({ ...f, automation: e.target.checked })} /> Automatiseringen aan (deadlines meeschuiven met draaidagen)</label></div>}
      </fieldset>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {conflict && (
        <div className="grid2">
          <div className="card"><h3>Jouw versie</h3><p className="small"><strong>{f.name}</strong></p><p className="small" style={{ whiteSpace: 'pre-line' }}>{f.briefing || '—'}</p></div>
          <div className="card"><h3>Versie van de ander</h3><p className="small"><strong>{String(conflict.name ?? '')}</strong></p><p className="small" style={{ whiteSpace: 'pre-line' }}>{String(conflict.briefing ?? '—')}</p></div>
        </div>
      )}
      {canEdit && (
        <div className="row">
          {!conflict && <button className="primary" onClick={() => save(base)}>Opslaan</button>}
          {conflict && <>
            <button onClick={async () => { setConflict(null); setMsg(null); await reloadProject(); }}>Versie van de ander houden</button>
            <button className="primary" onClick={forceSave}>Mijn versie opslaan</button>
          </>}
        </div>
      )}
    </div>
  );
}

function Beheer({ project, status, reloadProject, onMsg }: TabProps & { onMsg: (m: { kind: 'ok' | 'error'; text: string }) => void; canEditAny: boolean }) {
  const ctx = useCtx();
  const [newNumber, setNewNumber] = useState('');
  const [reason, setReason] = useState('');
  const primary = project.project_number.find((n) => n.kind === 'primair');
  const aliases = project.project_number.filter((n) => n.kind === 'alias');
  async function act(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    const { error } = await fn();
    onMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: ok });
    if (!error) { setNewNumber(''); setReason(''); }
    await reloadProject();
  }
  async function lifecycle(l: string) {
    const r = prompt(`Reden voor "${lifecycleLabel[l]}" (verplicht)`);
    if (!r?.trim()) return;
    await act(() => supabase.rpc('set_project_lifecycle', { p_project: project.id, p_lifecycle: l, p_reason: r }), `Project: ${lifecycleLabel[l]}.`);
  }
  const mayArchive = status.phase === 'administratief_klaar' || project.lifecycle === 'geannuleerd';
  return (
    <div className="card">
      <h2>Beheer</h2>
      <div className="stack">
        <div>
          <h3>Projectnummer</h3>
          <p>{primary ? <strong>{primary.number_display}</strong> : <Pill tone="warn">Geen nummer</Pill>}</p>
          {aliases.map((a) => <p key={a.id} className="small muted">Oud nummer {a.number_display} blijft gereserveerd · reden: {a.reason}</p>)}
          {isOwnerOrAdmin(ctx.role) && primary && !project.archived && (
            <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => supabase.rpc('correct_project_number', { p_project: project.id, p_new_number: newNumber, p_reason: reason }), 'Nummer gecorrigeerd; het oude nummer blijft als alias bestaan.'); }}>
              <input aria-label="Gecorrigeerd nummer" placeholder="Gecorrigeerd nummer" required value={newNumber} onChange={(e) => setNewNumber(e.target.value)} style={{ maxWidth: 180 }} />
              <input aria-label="Reden" placeholder="Reden" required value={reason} onChange={(e) => setReason(e.target.value)} style={{ maxWidth: 260 }} />
              <button>Nummer corrigeren</button>
            </form>
          )}
        </div>
        {!project.archived && (
          <div className="row">
            {project.lifecycle !== 'gepauzeerd' && project.lifecycle !== 'geannuleerd' && <button onClick={() => lifecycle('gepauzeerd')}>Pauzeren</button>}
            {project.lifecycle !== 'geannuleerd' && <button className="danger" onClick={() => lifecycle('geannuleerd')}>Annuleren</button>}
            {project.lifecycle !== 'actief' && project.lifecycle !== 'operationeel_afgerond' && <button onClick={() => lifecycle('actief')}>Weer actief maken</button>}
          </div>
        )}
        <div>
          <button disabled={!project.archived && !mayArchive}
            onClick={() => { if (project.archived || confirm('Archiveren? Het project wordt alleen-lezen en blijft vindbaar.')) void act(() => supabase.rpc('set_project_archived', { p_project: project.id, p_archived: !project.archived }), project.archived ? 'Uit archief gehaald.' : 'Gearchiveerd.'); }}>
            {project.archived ? 'Uit archief halen' : 'Archiveren'}
          </button>
          {!project.archived && !mayArchive && <span className="hint"> Archiveren kan bij "Administratief klaar" of een geannuleerd project.</span>}
        </div>
      </div>
    </div>
  );
}

function Concept({ project, status, reloadProject, onDone }: TabProps & { onDone: (t: string) => void }) {
  const [f, setF] = useState({ deliv: true, shoots: true });
  const [err, setErr] = useState('');
  const payload = project.concept_payload ?? {};
  const deliverables = (payload.deliverables ?? []) as { title?: string }[];
  const shoots = (payload.shoot_days ?? []) as { date?: string }[];
  async function confirm() {
    const { error } = await supabase.rpc('confirm_concept_project', { p_project: project.id, p_take_deliverables: f.deliv, p_take_shoot_days: f.shoots });
    if (error) return setErr(errText(error));
    onDone('Concept bevestigd.');
    await reloadProject();
  }
  void status;
  return (
    <div className="card" style={{ borderColor: 'var(--warn)' }}>
      <h2>Concept uit Bruto: ter bevestiging</h2>
      <p className="small">Dit project is aangemaakt door een "offerte akkoord"-bericht uit Bruto. Controleer naam en klant en kies wat je overneemt.</p>
      {deliverables.length > 0 && <label className="inline"><input type="checkbox" checked={f.deliv} onChange={(e) => setF({ ...f, deliv: e.target.checked })} /> Voorgestelde deliverables overnemen: {deliverables.map((d) => d.title).join(', ')}</label>}
      {shoots.length > 0 && <label className="inline"><input type="checkbox" checked={f.shoots} onChange={(e) => setF({ ...f, shoots: e.target.checked })} /> Geplande draaidagen overnemen (als optie): {shoots.map((s) => s.date).join(', ')}</label>}
      <Msg>{err}</Msg>
      <button className="primary" onClick={confirm}>Concept bevestigen</button>
    </div>
  );
}
