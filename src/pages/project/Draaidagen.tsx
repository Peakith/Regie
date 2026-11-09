import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { assignmentStatusLabel, datum, datumTijd, shootStatusLabel } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type Assign = { id: string; person_id: string; role_label: string; status: string; person: { full_name: string } };
type Shoot = {
  id: string; title: string | null; date: string; start_time: string | null; end_time: string | null; location: string | null;
  status: string; status_reason: string | null; executed_confirmed_at: string | null; backup_confirmed_at: string | null;
  callsheet_note: string | null; equipment_note: string | null; revision: number; assignment: Assign[];
};

export default function Draaidagen({ project, canEdit, people }: TabProps) {
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from('shoot_day').select('*, assignment(id,person_id,role_label,status,person(full_name))')
      .eq('project_id', project.id).order('date')) as Shoot[], [project.id]);
  const [f, setF] = useState({ date: '', start: '', end: '', location: '', title: '' });
  const [err, setErr] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('shoot_day').insert({
      project_id: project.id, date: f.date, start_time: f.start || null, end_time: f.end || null,
      location: f.location || null, title: f.title || null,
    });
    if (error) return setErr(errText(error));
    setF({ date: '', start: '', end: '', location: '', title: '' });
    await reload();
  }

  if (loading && !data) return <Loading />;
  return (
    <>
      {!project.production_applicable && <Msg kind="info">Productie is voor dit project als "niet van toepassing" gemarkeerd. Draaidagen zijn niet vereist om af te sluiten.</Msg>}
      <Msg>{error}</Msg>
      {data?.length === 0 && <div className="card muted">Nog geen draaidagen.</div>}
      {data?.map((s) => <ShootItem key={s.id} s={s} canEdit={canEdit} people={people} projectId={project.id} reload={reload} />)}
      {canEdit && (
        <form className="card" onSubmit={add}>
          <h2>Draaidag toevoegen</h2>
          <div className="grid2">
            <Field id="sd" label="Datum"><input id="sd" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field id="ss" label="Starttijd"><input id="ss" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field id="se" label="Eindtijd"><input id="se" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
            <Field id="sl" label="Locatie"><input id="sl" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field id="st" label="Omschrijving (optioneel)"><input id="st" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bijv. Draaidag 1" /></Field>
          </div>
          <Msg>{err}</Msg>
          <button className="primary">Toevoegen</button>
        </form>
      )}
    </>
  );
}

function ShootItem({ s, canEdit, people, projectId, reload }: { s: Shoot; canEdit: boolean; people: TabProps['people']; projectId: string; reload: () => Promise<void> }) {
  const [err, setErr] = useState('');
  const [crew, setCrew] = useState({ person: '', role: '', status: 'optie' });
  const [notes, setNotes] = useState({ callsheet: s.callsheet_note ?? '', equipment: s.equipment_note ?? '' });

  async function update(patch: Record<string, unknown>) {
    setErr('');
    const { data, error } = await supabase.from('shoot_day').update(patch).eq('id', s.id).eq('revision', s.revision).select('id');
    if (error) setErr(errText(error));
    else if (!data?.length) setErr('Iemand anders heeft deze draaidag intussen gewijzigd. De nieuwste stand is geladen; probeer opnieuw.');
    await reload();
  }
  async function setStatus(status: string) {
    if (status === 'geannuleerd') {
      const r = prompt('Waarom is deze draaidag geannuleerd? (verplicht)');
      if (!r?.trim()) return;
      return update({ status, status_reason: r });
    }
    if (status === 'uitgevoerd' && !confirm('Bevestig je dat deze draaidag is uitgevoerd? Je naam en het tijdstip worden vastgelegd.')) return;
    return update({ status });
  }
  async function addCrew(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('assignment').insert({ project_id: projectId, shoot_day_id: s.id, person_id: crew.person, role_label: crew.role || 'crew', status: crew.status });
    if (error) return setErr(errText(error));
    setCrew({ person: '', role: '', status: 'optie' });
    await reload();
  }
  async function setCrewStatus(a: Assign, status: string) {
    const { error } = await supabase.from('assignment').update({ status }).eq('id', a.id);
    if (error) setErr(errText(error));
    await reload();
  }

  const time = [s.start_time?.slice(0, 5), s.end_time?.slice(0, 5)].filter(Boolean).join('–');
  return (
    <div className="item">
      <div className="row between">
        <div>
          <strong>{datum(s.date)}</strong> {time && <span>{time}</span>} {s.title && <span className="muted">· {s.title}</span>}
          <div className="small muted">{s.location ?? 'Locatie onbekend'}</div>
        </div>
        <div className="row">
          <Pill tone={s.status === 'uitgevoerd' ? 'ok' : s.status === 'geannuleerd' ? undefined : 'info'}>{shootStatusLabel[s.status]}</Pill>
          {s.status === 'uitgevoerd' && (s.backup_confirmed_at ? <Pill tone="ok">Back-up bevestigd</Pill> : <Pill tone="warn">Back-up niet bevestigd</Pill>)}
        </div>
      </div>
      {s.status === 'geannuleerd' && <Msg kind="info">Geannuleerd: {s.status_reason}</Msg>}
      <div className="stack" style={{ marginTop: 10 }}>
        {canEdit && (
          <div className="row">
            <label htmlFor={`ss-${s.id}`} style={{ margin: 0 }}>Status</label>
            <select id={`ss-${s.id}`} value={s.status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200 }}>
              {Object.entries(shootStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {s.status === 'uitgevoerd' && !s.backup_confirmed_at && (
              <button onClick={() => { if (confirm('Bevestig dat de footage is geback-upt op SSD en HDD.')) void update({ backup_confirmed_at: new Date().toISOString() }); }}>
                Back-up footage bevestigen
              </button>
            )}
          </div>
        )}
        {s.executed_confirmed_at && <p className="small muted">Uitgevoerd bevestigd {datumTijd(s.executed_confirmed_at)}{s.backup_confirmed_at ? ` · back-up bevestigd ${datumTijd(s.backup_confirmed_at)}` : ''}</p>}

        <h3>Crew</h3>
        {s.assignment.length === 0 && <p className="small muted">Nog geen crew ingepland.</p>}
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
          <form className="row" onSubmit={addCrew}>
            <select aria-label="Persoon" required value={crew.person} onChange={(e) => setCrew({ ...crew, person: e.target.value })} style={{ maxWidth: 220 }}>
              <option value="">Kies persoon…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.roles.length ? ` (${p.roles.join(', ')})` : ''}</option>)}
            </select>
            <input aria-label="Rol op de set" placeholder="Rol, bijv. camera" value={crew.role} onChange={(e) => setCrew({ ...crew, role: e.target.value })} style={{ maxWidth: 180 }} />
            <select aria-label="Optie of bevestigd" value={crew.status} onChange={(e) => setCrew({ ...crew, status: e.target.value })} style={{ maxWidth: 140 }}>
              <option value="optie">Optie</option><option value="bevestigd">Bevestigd</option>
            </select>
            <button>Inplannen</button>
          </form>
        )}
        <p className="hint">Inplannen geeft geen toegang tot Regie en verstuurt geen bericht. Overlapcontrole met andere projecten volgt in fase 2.</p>

        <div className="grid2">
          <Field id={`cs-${s.id}`} label="Callsheet / briefing"><textarea id={`cs-${s.id}`} disabled={!canEdit} value={notes.callsheet} onChange={(e) => setNotes({ ...notes, callsheet: e.target.value })} /></Field>
          <Field id={`eq-${s.id}`} label="Apparatuur"><textarea id={`eq-${s.id}`} disabled={!canEdit} value={notes.equipment} onChange={(e) => setNotes({ ...notes, equipment: e.target.value })} /></Field>
        </div>
        {canEdit && <div><button onClick={() => update({ callsheet_note: notes.callsheet || null, equipment_note: notes.equipment || null })}>Notities opslaan</button></div>}
        <Msg>{err}</Msg>
      </div>
    </div>
  );
}
