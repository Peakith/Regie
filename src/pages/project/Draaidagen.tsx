import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { assignmentStatusLabel, datumTijd, dagKort, shootStatusLabel2 } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import Opmerkingen from '../../components/Opmerkingen';
import type { TabProps } from './types';

type Assign = { id: string; person_id: string; role_label: string; status: string; person: { full_name: string } };
type Equip = { id: string; description: string; picked_up: boolean; returned: boolean; revision: number };
type Shoot = {
  id: string; title: string | null; date: string; start_time: string | null; end_time: string | null; location: string | null;
  status: string; status_reason: string | null; backup_ssd_at: string | null; backup_hdd_at: string | null;
  callsheet_note: string | null; callsheet_link: string | null; revision: number; assignment: Assign[]; equipment_item: Equip[];
};
type Run = { id: string; summary: string; undo_data: { title: string; old: string | null; new: string | null }[]; status: string; created_at: string };

const ended = (s: Shoot) => new Date(`${s.date}T${s.end_time ?? '23:59'}`) <= new Date();

export default function Draaidagen(props: TabProps) {
  const { project, canEdit, canManage, reloadProject } = props;
  const { data, error, loading, reload } = useLoad(async () => {
    const shoots = must(await supabase.from('shoot_day').select('*, assignment(id,person_id,role_label,status,person(full_name)), equipment_item(id,description,picked_up,returned,revision)')
      .eq('project_id', project.id).order('date')) as Shoot[];
    const runs = must(await supabase.from('automation_run').select('id,summary,undo_data,status,created_at').eq('project_id', project.id)
      .eq('kind', 'AU2').eq('status', 'ok').gte('created_at', new Date(Date.now() - 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(1)) as Run[];
    return { shoots, run: runs[0] };
  }, [project.id]);
  const [f, setF] = useState({ date: '', start: '', end: '', location: '', title: '', status: 'optie' });
  const [err, setErr] = useState('');
  const [undoMsg, setUndoMsg] = useState('');
  const refresh = async () => { await reload(); await reloadProject(); };

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('shoot_day').insert({
      project_id: project.id, date: f.date, start_time: f.start || null, end_time: f.end || null,
      location: f.location || null, title: f.title || null, status: f.status,
    });
    if (error) return setErr(errText(error));
    setF({ date: '', start: '', end: '', location: '', title: '', status: 'optie' });
    await refresh();
  }

  if (loading && !data) return <Loading />;
  return (
    <>
      {!project.production_applicable && <Msg kind="info">Dit project heeft "geen opnames". Draaidagen zijn niet nodig voor de faselogica.</Msg>}
      <Msg>{error}</Msg>
      {data?.run && canManage && (
        <Msg kind="info">
          <strong>Deadlines meegeschoven:</strong> {data.run.summary} ({datumTijd(data.run.created_at)}).
          <ul className="plain">{data.run.undo_data.slice(0, 8).map((c, i) => <li key={i} className="small">{c.title}: {dagKort(c.old)} → {dagKort(c.new)}</li>)}</ul>
          <button onClick={async () => {
            const { data: r, error } = await supabase.rpc('undo_automation', { p_run: data.run!.id });
            setUndoMsg(error ? errText(error) : `Ongedaan gemaakt: ${r}.`);
            await refresh();
          }}>Ongedaan maken</button>
        </Msg>
      )}
      {undoMsg && <Msg kind="ok">{undoMsg}</Msg>}
      {data?.shoots.length === 0 && <div className="card muted">Nog geen draaidagen.</div>}
      {data?.shoots.map((s) => <ShootItem key={s.id} s={s} {...props} reload={refresh} />)}
      {canEdit && (
        <form className="card" onSubmit={add}>
          <h2>Draaidag toevoegen</h2>
          <div className="grid2">
            <Field id="sd" label="Datum"><input id="sd" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field id="ss" label="Starttijd"><input id="ss" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field id="se" label="Eindtijd"><input id="se" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
            <Field id="sl" label="Locatie"><input id="sl" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field id="st" label="Omschrijving (optioneel)"><input id="st" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bijv. Draaidag 1" /></Field>
            <Field id="sst" label="Status">
              <select id="sst" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="optie">Optie</option><option value="bevestigd">Bevestigd</option>
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

function ShootItem({ s, canEdit, canManage, people, project, reload }: TabProps & { s: Shoot; reload: () => Promise<void> }) {
  const [err, setErr] = useState('');
  const [crew, setCrew] = useState({ person: '', role: '', status: 'optie' });
  const [conflicts, setConflicts] = useState<{ project_label: string; role_label: string; status: string }[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ date: s.date, start: s.start_time?.slice(0, 5) ?? '', end: s.end_time?.slice(0, 5) ?? '', location: s.location ?? '',
    title: s.title ?? '', callsheet: s.callsheet_note ?? '', link: s.callsheet_link ?? '' });
  const [equip, setEquip] = useState('');

  async function update(patch: Record<string, unknown>) {
    setErr('');
    const { data, error } = await supabase.from('shoot_day').update(patch).eq('id', s.id).eq('revision', s.revision).select('id');
    if (error) setErr(errText(error));
    else if (!data?.length) setErr('Iemand anders heeft deze draaidag intussen gewijzigd. Je invoer is niet opgeslagen; de nieuwste stand is geladen.');
    await reload();
    return !error && !!data?.length;
  }
  async function setStatus(status: string) {
    if (status === 'geannuleerd') {
      const r = prompt('Waarom is deze draaidag geannuleerd? (verplicht)');
      if (!r?.trim()) return;
      return update({ status, status_reason: r });
    }
    return update({ status });
  }
  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    const moved = form.date !== s.date;
    const ok = await update({
      date: form.date, start_time: form.start || null, end_time: form.end || null, location: form.location || null,
      title: form.title || null, callsheet_note: form.callsheet || null, callsheet_link: form.link || null,
      ...(moved && s.status === 'bevestigd' ? { status: 'verplaatst' } : {}),
    });
    if (ok) setEdit(false);
  }
  // AU6: waarschuwing vóór het opslaan als de persoon die dag al elders staat.
  async function addCrew(e: FormEvent, force = false) {
    e.preventDefault();
    setErr('');
    if (!force) {
      const { data } = await supabase.rpc('booking_conflicts', { p_person: crew.person, p_date: s.date, p_exclude_shoot_day: s.id });
      if (data?.length) return setConflicts(data);
    }
    const { error } = await supabase.from('assignment').insert({ project_id: project.id, shoot_day_id: s.id, person_id: crew.person, role_label: crew.role || 'crew', status: crew.status });
    if (error) return setErr(errText(error));
    setCrew({ person: '', role: '', status: 'optie' }); setConflicts(null);
    await reload();
  }
  async function setCrewStatus(a: Assign, status: string) {
    const { error } = await supabase.from('assignment').update({ status }).eq('id', a.id);
    if (error) setErr(errText(error));
    await reload();
  }
  async function equipPatch(e: Equip, patch: Record<string, unknown>) {
    const { data, error } = await supabase.from('equipment_item').update(patch).eq('id', e.id).eq('revision', e.revision).select('id');
    if (error) setErr(errText(error)); else if (!data?.length) setErr('Deze apparatuurregel is intussen gewijzigd; nieuwste stand geladen.');
    await reload();
  }

  const time = [s.start_time?.slice(0, 5), s.end_time?.slice(0, 5)].filter(Boolean).join('–');
  const past = ended(s);
  const backupMissing = s.status === 'bevestigd' && past && (!s.backup_ssd_at || !s.backup_hdd_at);
  return (
    <div className="item">
      <div className="row between">
        <div>
          <strong>{dagKort(s.date)}</strong> {time && <span>{time}</span>} {s.title && <span className="muted">· {s.title}</span>}
          <div className="small muted">{s.location ?? 'Locatie onbekend'}{s.callsheet_link && <> · <a href={s.callsheet_link} target="_blank" rel="noreferrer">Callsheet</a></>}</div>
        </div>
        <div className="row">
          <Pill tone={s.status === 'bevestigd' ? 'ok' : s.status === 'geannuleerd' ? undefined : 'info'}>{shootStatusLabel2[s.status] ?? s.status}</Pill>
          {backupMissing && <Pill tone="danger">Back-up ontbreekt</Pill>}
        </div>
      </div>
      {s.status === 'geannuleerd' && <Msg kind="info">Geannuleerd: {s.status_reason}</Msg>}
      <div className="stack" style={{ marginTop: 10 }}>
        {canEdit && (
          <div className="row">
            <label htmlFor={`ss-${s.id}`} style={{ margin: 0 }}>Status</label>
            <select id={`ss-${s.id}`} value={s.status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200 }}>
              {Object.entries(shootStatusLabel2).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {!edit && <button onClick={() => setEdit(true)}>Datum, tijden en callsheet bewerken</button>}
          </div>
        )}
        {edit && (
          <form onSubmit={saveDetails} className="card" style={{ padding: 12 }}>
            <div className="grid2">
              <Field id={`d-${s.id}`} label="Datum" hint="Een andere datum schuift open ankertaken mee (in werkdagen). Crew krijgt geen automatisch bericht.">
                <input id={`d-${s.id}`} type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field id={`s-${s.id}`} label="Start"><input id={`s-${s.id}`} type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
              <Field id={`e-${s.id}`} label="Eind"><input id={`e-${s.id}`} type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
              <Field id={`l-${s.id}`} label="Locatie"><input id={`l-${s.id}`} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
              <Field id={`t-${s.id}`} label="Omschrijving"><input id={`t-${s.id}`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field id={`cl-${s.id}`} label="Link naar callsheet"><input id={`cl-${s.id}`} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" /></Field>
            </div>
            <Field id={`cs-${s.id}`} label="Callsheet / briefing (zichtbaar voor ingeboekte crew)"><textarea id={`cs-${s.id}`} value={form.callsheet} onChange={(e) => setForm({ ...form, callsheet: e.target.value })} /></Field>
            <div className="row"><button className="primary">Opslaan</button><button type="button" onClick={() => setEdit(false)}>Annuleren</button></div>
          </form>
        )}
        {!edit && s.callsheet_note && <p className="small" style={{ whiteSpace: 'pre-line' }}><strong>Callsheet:</strong> {s.callsheet_note}</p>}

        <h3>Back-up footage</h3>
        <div className="row">
          {(['ssd', 'hdd'] as const).map((k) => {
            const at = k === 'ssd' ? s.backup_ssd_at : s.backup_hdd_at;
            return (
              <label key={k} className="inline">
                <input type="checkbox" disabled={!canEdit} checked={!!at}
                  onChange={(e) => update({ [`backup_${k}_at`]: e.target.checked ? new Date().toISOString() : null })} />
                {k.toUpperCase()} {at && <span className="small muted">({datumTijd(at)})</span>}
              </label>
            );
          })}
        </div>
        {!past && <p className="hint">Na afloop van de draaidag houdt een ontbrekende back-up de fase vast en verschijnt er een blokkade.</p>}

        <h3>Crew</h3>
        {s.assignment.length === 0 && <p className="small muted">Nog geen crew ingeboekt.</p>}
        {s.assignment.map((a) => (
          <div key={a.id} className="row">
            <span>{a.person.full_name} <span className="muted">· {a.role_label}</span></span>
            {canEdit ? (
              <select aria-label={`Status ${a.person.full_name}`} value={a.status} onChange={(e) => setCrewStatus(a, e.target.value)} style={{ maxWidth: 160 }}>
                {Object.entries(assignmentStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            ) : <Pill>{assignmentStatusLabel[a.status]}</Pill>}
          </div>
        ))}
        {canEdit && (
          <form className="row" onSubmit={(e) => addCrew(e)}>
            <select aria-label="Persoon" required value={crew.person} onChange={(e) => { setCrew({ ...crew, person: e.target.value }); setConflicts(null); }} style={{ maxWidth: 220 }}>
              <option value="">Kies persoon…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.roles.length ? ` (${p.roles.join(', ')})` : ''}</option>)}
            </select>
            <input aria-label="Rol op de set" placeholder="Rol, bijv. camera" value={crew.role} onChange={(e) => setCrew({ ...crew, role: e.target.value })} style={{ maxWidth: 180 }} />
            <select aria-label="Optie of bevestigd" value={crew.status} onChange={(e) => setCrew({ ...crew, status: e.target.value })} style={{ maxWidth: 140 }}>
              <option value="optie">Optie</option><option value="bevestigd">Bevestigd</option>
            </select>
            <button>Inboeken</button>
          </form>
        )}
        {conflicts && (
          <Msg kind="warn">
            Let op: deze persoon staat op {dagKort(s.date)} al ingeboekt bij: {conflicts.map((c) => `${c.project_label} (${c.role_label}, ${c.status})`).join('; ')}.{' '}
            <button onClick={(e) => addCrew(e as unknown as FormEvent, true)}>Toch inboeken</button> <button onClick={() => setConflicts(null)}>Annuleren</button>
          </Msg>
        )}
        <p className="hint">Inboeken geeft geen toegang tot Regie en verstuurt geen bericht.</p>

        <h3>Apparatuur</h3>
        {s.equipment_item.length === 0 && <p className="small muted">Nog geen apparatuurregels.</p>}
        {s.equipment_item.map((e) => (
          <div key={e.id} className="row">
            <span style={{ minWidth: 160 }}>{e.description}</span>
            <label className="inline"><input type="checkbox" disabled={!canEdit} checked={e.picked_up} onChange={(ev) => equipPatch(e, { picked_up: ev.target.checked })} /> opgehaald</label>
            <label className="inline"><input type="checkbox" disabled={!canEdit} checked={e.returned} onChange={(ev) => equipPatch(e, { returned: ev.target.checked })} /> teruggebracht</label>
            {past && !e.returned && <Pill tone="warn">Nog niet terug</Pill>}
            {canEdit && <button className="link small" onClick={async () => { const { error } = await supabase.rpc('soft_delete', { p_kind: 'equipment', p_id: e.id }); if (error) setErr(errText(error)); await reload(); }}>verwijderen</button>}
          </div>
        ))}
        {canEdit && (
          <form className="row" onSubmit={async (ev) => {
            ev.preventDefault();
            const { error } = await supabase.from('equipment_item').insert({ project_id: project.id, shoot_day_id: s.id, description: equip, sort: s.equipment_item.length });
            if (error) return setErr(errText(error));
            setEquip(''); await reload();
          }}>
            <input aria-label="Apparatuur" placeholder="bijv. Sony FX6 + 3 accu's" required value={equip} onChange={(e) => setEquip(e.target.value)} style={{ maxWidth: 320 }} />
            <button>Toevoegen</button>
          </form>
        )}

        <details>
          <summary>Opmerkingen</summary>
          <Opmerkingen projectId={project.id} subjectType="shoot_day" subjectId={s.id} canEdit={canEdit} allowCrew />
        </details>
        {canManage && (
          <div><button className="danger" onClick={async () => {
            if (!confirm('Draaidag naar de prullenbak? Herstellen kan 30 dagen.')) return;
            const { error } = await supabase.rpc('soft_delete', { p_kind: 'shoot_day', p_id: s.id });
            if (error) setErr(errText(error)); await reload();
          }}>Draaidag verwijderen</button></div>
        )}
        <Msg>{err}</Msg>
      </div>
    </div>
  );
}
