import { Link } from 'react-router-dom';
import { dagKort, datumTijd, taskStatusLabel } from '../lib/labels';
import { Pill } from '../components/ui';

type Snap = { generated_at: string; shoot_days: { id: string; date: string; start_time: string | null; end_time: string | null; location: string | null; title: string | null;
  status: string; callsheet_note: string | null; callsheet_link: string | null; project: string;
  crew: { name: string; role: string; status: string; phone?: string | null }[] | null; equipment: { description: string; picked_up: boolean; returned: boolean }[] | null }[];
  tasks: { id: string; title: string; status: string; deadline: string | null; project: string | null }[] };

/** Alleen-lezen kopie van de komende 7 dagen en eigen taken. Bewerken kan niet zonder verbinding. */
export default function Offline() {
  let snap: Snap | null = null;
  try { snap = JSON.parse(localStorage.getItem('regie-offline') ?? 'null'); } catch { snap = null; }
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <div className="row between">
        <img src="/brand/regie-woordmerk.png" alt="Regie" style={{ height: 26, filter: 'var(--logo-filter)' }} />
        <span className={`pill ${navigator.onLine ? 'ok' : 'danger'}`}>{navigator.onLine ? 'Online' : 'Offline: wijzigingen niet mogelijk'}</span>
      </div>
      <h1>Offline weergave</h1>
      {!snap ? <p>Er is nog geen offline kopie op dit apparaat. Open Regie één keer met verbinding.</p> : (
        <>
          <p className="small muted">Kopie van {datumTijd(snap.generated_at)}. Alleen lezen. {navigator.onLine && <Link to="/">Terug naar Regie</Link>}</p>
          <h2>Draaidagen komende 7 dagen</h2>
          {snap.shoot_days.length === 0 && <p className="muted">Geen draaidagen.</p>}
          {snap.shoot_days.map((d) => (
            <article key={d.id} className="card">
              <h3>{dagKort(d.date)} {[d.start_time?.slice(0, 5), d.end_time?.slice(0, 5)].filter(Boolean).join('–')} · {d.project}</h3>
              <p className="small">{d.title ?? ''} {d.location ? `· ${d.location}` : ''} <Pill>{d.status}</Pill></p>
              {d.callsheet_note && <p style={{ whiteSpace: 'pre-line' }}>{d.callsheet_note}</p>}
              {d.callsheet_link && <p className="small">Callsheet: {d.callsheet_link}</p>}
              {d.crew && <ul className="plain">{d.crew.map((c, i) => <li key={i} className="small">{c.name} · {c.role}{c.phone ? ` · ${c.phone}` : ''}</li>)}</ul>}
              {d.equipment && <><strong className="small">Apparatuur</strong><ul className="plain">{d.equipment.map((e, i) => <li key={i} className="small">{e.picked_up ? '☑' : '☐'} {e.description}</li>)}</ul></>}
            </article>
          ))}
          <h2>Mijn taken</h2>
          <ul className="plain card">
            {snap.tasks.map((t) => <li key={t.id} className="small">{t.title} · {taskStatusLabel[t.status]}{t.deadline ? ` · ${dagKort(t.deadline)}` : ''}{t.project ? ` · ${t.project}` : ''}</li>)}
            {snap.tasks.length === 0 && <li className="muted small">Geen open taken.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
