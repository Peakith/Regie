import { useState } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { SyncStatus } from '../lib/live';
import { assignmentStatusLabel, dagKort, datumTijd, roleLabel, taskStatusLabel } from '../lib/labels';
import { Loading, Msg, Pill } from '../components/ui';

type Day = { id: string; date: string; start_time: string | null; end_time: string | null; location: string | null; status: string; title: string | null;
  callsheet_link: string | null; callsheet_note: string | null; project: string; client: string | null; my_role: string; my_status: string;
  crew: { name: string; role: string; status: string }[] | null; equipment: { description: string; picked_up: boolean; returned: boolean }[] | null;
  notes: { body: string; at: string }[] | null; links: { label: string; url: string }[] | null };
type Task = { id: string; title: string; status: string; deadline: string | null; project: string; notes: { body: string; at: string }[] | null };

/** Freelancer-weergave (fase 8): alleen eigen draaidagen en wat met de crew gedeeld is, servermatig samengesteld. */
export default function Crew() {
  const { ctx, session } = useSession();
  const { data, error, loading, reload } = useLoad(async () => ({
    days: must(await supabase.rpc('crew_shoot_days', {})) as Day[],
    tasks: must(await supabase.rpc('crew_tasks')) as Task[],
  }), []);
  if (!ctx) return null;
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <img src="/brand/regie-woordmerk.png" alt="Regie" style={{ height: 26, filter: 'var(--logo-filter)' }} />
        <div className="row"><SyncStatus /><span className="small muted">{ctx.person_name ?? session?.user.email} · {roleLabel[ctx.role]}</span>
          <button className="link small" onClick={() => supabase.auth.signOut()}>Uitloggen</button></div>
      </div>
      <h1>Mijn draaidagen</h1>
      <Msg>{error}</Msg>
      {loading && !data ? <Loading /> : (
        <>
          {data?.days.length === 0 && <div className="card muted">Je bent nog niet ingeboekt op een draaidag.</div>}
          {data?.days.map((d) => (
            <article key={d.id} className="card">
              <div className="row between">
                <h2 style={{ margin: 0 }}>{dagKort(d.date)} {[d.start_time?.slice(0, 5), d.end_time?.slice(0, 5)].filter(Boolean).join('–')}</h2>
                <Pill tone={d.status === 'bevestigd' ? 'ok' : 'info'}>{d.status}</Pill>
              </div>
              <p><strong>{d.project}</strong>{d.client ? ` – ${d.client}` : ''}{d.title ? ` · ${d.title}` : ''}</p>
              <div className="kv">
                <span className="muted">Locatie</span><span>{d.location ?? 'nog onbekend'}</span>
                <span className="muted">Jouw rol</span><span>{d.my_role} ({assignmentStatusLabel[d.my_status]?.toLowerCase()})</span>
                {d.callsheet_link && <><span className="muted">Callsheet</span><a href={d.callsheet_link} target="_blank" rel="noreferrer">Openen</a></>}
              </div>
              {d.callsheet_note && <p style={{ whiteSpace: 'pre-line' }}>{d.callsheet_note}</p>}
              {d.crew && <><h3>Crew</h3><ul className="plain">{d.crew.map((c, i) => <li key={i} className="small">{c.name} · {c.role}{c.status === 'optie' ? ' (optie)' : ''}</li>)}</ul></>}
              {d.equipment && <><h3>Apparatuur</h3><ul className="plain">{d.equipment.map((e, i) => <li key={i} className="small">{e.description}{e.picked_up ? ' · opgehaald' : ''}{e.returned ? ' · terug' : ''}</li>)}</ul></>}
              {d.notes && <><h3>Mededelingen</h3>{d.notes.map((n, i) => <p key={i} className="small">{n.body} <span className="muted">· {datumTijd(n.at)}</span></p>)}</>}
              {d.links && <><h3>Links</h3>{d.links.map((l, i) => <p key={i} className="small"><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></p>)}</>}
            </article>
          ))}
          <h1>Mijn taken</h1>
          {data?.tasks.length === 0 && <div className="card muted">Geen taken op jouw naam.</div>}
          {data?.tasks.map((t) => <CrewTask key={t.id} t={t} reload={reload} />)}
          <p className="hint">Je ziet alleen draaidagen waarop je bent ingeboekt en wat met de crew is gedeeld. Offline: de komende 7 dagen blijven leesbaar via /offline.</p>
        </>
      )}
    </div>
  );
}

function CrewTask({ t, reload }: { t: Task; reload: () => Promise<void> }) {
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  async function save(status: string) {
    const { error } = await supabase.rpc('crew_update_task', { p_task: t.id, p_status: status, p_comment: comment || null });
    if (error) return setErr(errText(error));
    setComment(''); setErr('');
    await reload();
  }
  return (
    <div className="card">
      <strong>{t.title}</strong> <span className="small muted">· {t.project}{t.deadline ? ` · ${dagKort(t.deadline)}` : ''}</span>
      {t.notes?.map((n, i) => <p key={i} className="small">{n.body} <span className="muted">· {datumTijd(n.at)}</span></p>)}
      <div className="row" style={{ marginTop: 8 }}>
        <select aria-label={`Status ${t.title}`} value={t.status} onChange={(e) => save(e.target.value)} style={{ maxWidth: 160 }}>
          {['te_doen', 'bezig', 'geblokkeerd', 'klaar'].map((s) => <option key={s} value={s}>{taskStatusLabel[s]}</option>)}
        </select>
        <input aria-label="Opmerking" placeholder="Opmerking (zichtbaar voor de productie)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <button disabled={!comment.trim()} onClick={() => save(t.status)}>Plaatsen</button>
      </div>
      <Msg>{err}</Msg>
    </div>
  );
}
