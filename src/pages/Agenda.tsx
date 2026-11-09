import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, plusDagen, vandaag } from '../lib/labels';
import { Loading, Msg } from '../components/ui';

type Ev = { date: string; kind: 'draaidag' | 'deliverable' | 'taak'; title: string; project_id: string; label: string; late: boolean };

const startOfWeek = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); const w = (d.getUTCDay() + 6) % 7; return plusDagen(iso, -w); };

/** Agenda: draaidagen en deadlines over alle projecten, maand- en weekweergave. */
export default function Agenda() {
  const ctx = useCtx();
  const [mode, setMode] = useState<'maand' | 'week'>(window.innerWidth < 760 ? 'week' : 'maand');
  const [anchor, setAnchor] = useState(vandaag());
  const [company, setCompany] = useState('');
  const [types, setTypes] = useState({ draaidag: true, deliverable: true, taak: true });
  const first = mode === 'maand' ? startOfWeek(anchor.slice(0, 8) + '01') : startOfWeek(anchor);
  const days = mode === 'maand' ? 42 : 7;
  const last = plusDagen(first, days - 1);

  const { data, error, loading } = useLoad(async () => {
    const [s, d, t] = await Promise.all([
      supabase.from('shoot_day').select('date,title,location,status,project_id,project!inner(name,company,archived)').gte('date', first).lte('date', last).neq('status', 'geannuleerd'),
      supabase.from('deliverable').select('deadline,title,status,project_id,project!inner(name,company,archived)').gte('deadline', first).lte('deadline', last).not('status', 'in', '(geleverd,vervallen)'),
      supabase.from('task').select('deadline,title,status,project_id,project!inner(name,company,archived)').gte('deadline', first).lte('deadline', last).not('status', 'in', '(klaar,vervallen)'),
    ]);
    type R = { project_id: string; title: string | null; status: string; project: { name: string; company: string; archived: boolean } };
    const ev: (Ev & { company: string })[] = [
      ...(must(s) as (R & { date: string; location: string | null })[]).map((x) => ({ date: x.date, kind: 'draaidag' as const, title: `${x.title ?? 'Draaidag'}${x.location ? ' · ' + x.location : ''}${x.status === 'optie' ? ' (optie)' : ''}`, project_id: x.project_id, label: x.project.name, late: false, company: x.project.company })),
      ...(must(d) as (R & { deadline: string })[]).map((x) => ({ date: x.deadline, kind: 'deliverable' as const, title: x.title ?? '', project_id: x.project_id, label: x.project.name, late: x.deadline < vandaag(), company: x.project.company })),
      ...(must(t) as (R & { deadline: string })[]).map((x) => ({ date: x.deadline, kind: 'taak' as const, title: x.title ?? '', project_id: x.project_id, label: x.project.name, late: x.deadline < vandaag(), company: x.project.company })),
    ];
    return ev;
  }, [first, last, ctx.workspace_id]);

  const events = (data ?? []).filter((e) => (!company || e.company === company) && types[e.kind]);
  const month = anchor.slice(0, 7);
  const title = mode === 'maand'
    ? new Date(anchor + 'T12:00:00Z').toLocaleDateString('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `Week van ${new Date(first + 'T12:00:00Z').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  const move = (n: number) => setAnchor(mode === 'maand' ? (() => { const d = new Date(anchor.slice(0, 8) + '15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); })() : plusDagen(anchor, 7 * n));

  return (
    <>
      <div className="row between">
        <h1 style={{ textTransform: 'capitalize' }}>Agenda · {title}</h1>
        <div className="row">
          <button onClick={() => move(-1)} aria-label="Vorige">←</button>
          <button onClick={() => setAnchor(vandaag())}>Vandaag</button>
          <button onClick={() => move(1)} aria-label="Volgende">→</button>
          <select aria-label="Weergave" value={mode} onChange={(e) => setMode(e.target.value as 'maand' | 'week')} style={{ maxWidth: 120 }}>
            <option value="maand">Maand</option><option value="week">Week</option>
          </select>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select aria-label="Bedrijf" value={company} onChange={(e) => setCompany(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Alle bedrijven</option>
          {Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {(['draaidag', 'deliverable', 'taak'] as const).map((k) => (
          <label key={k} className="inline"><input type="checkbox" checked={types[k]} onChange={(e) => setTypes({ ...types, [k]: e.target.checked })} /> {k === 'draaidag' ? 'Draaidagen' : k === 'deliverable' ? 'Deliverable-deadlines' : 'Taakdeadlines'}</label>
        ))}
      </div>
      <Msg>{error}</Msg>
      {loading && !data ? <Loading /> : (
        <div className="cal" role="grid" aria-label="Agenda">
          {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => <div key={d} className="dh" role="columnheader">{d}</div>)}
          {Array.from({ length: days }, (_, i) => plusDagen(first, i)).map((day) => {
            const evs = events.filter((e) => e.date === day).sort((a, b) => a.kind.localeCompare(b.kind));
            const other = mode === 'maand' && day.slice(0, 7) !== month;
            return (
              <div key={day} role="gridcell" className={`day ${other ? 'other' : ''} ${other && !evs.length ? 'empty' : ''} ${day === vandaag() ? 'today' : ''}`}>
                <div className="n">{new Date(day + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
                {evs.map((e, n) => (
                  <Link key={n} to={`/projecten/${e.project_id}?tab=${e.kind === 'draaidag' ? 'Draaidagen' : e.kind === 'deliverable' ? 'Deliverables' : 'Taken'}`}
                    className={`ev ${e.kind === 'draaidag' ? 'shoot' : ''} ${e.late ? 'late' : ''}`} title={`${e.label}: ${e.title}`}>
                    {e.kind === 'draaidag' ? '● ' : ''}{e.title} · {e.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
