import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, dagKort, isVerlopen, phaseLabel, vandaag } from '../lib/labels';
import { Loading, Msg, Pill } from '../components/ui';

type Item = { project_id: string | null; object_id: string; title: string; project?: string | null; date?: string; deadline?: string;
  type?: string; status?: string; text?: string; since?: string; meerwerk?: boolean; days?: number; over_threshold?: boolean };
type Dash = {
  week: Item[]; overdue: number; waiting_client: Item[]; blockers: Item[]; stale: Item[] | null; my_actions: Item[];
  concepts: { project_id: string; project: string }[]; phases: Record<string, number> | null; finance_visible: boolean;
};

export default function Dashboard() {
  const ctx = useCtx();
  const [company, setCompany] = useState('');
  const [person, setPerson] = useState('');
  const { data, error, loading } = useLoad(async () => {
    // Tijdsafhankelijke fases en meldingen bijwerken (aanvulling op de periodieke taak).
    await supabase.rpc('refresh_workspace', { p_ws: ctx.workspace_id });
    const [d, people] = await Promise.all([
      supabase.rpc('dashboard', { p_ws: ctx.workspace_id, p_company: company || null, p_person: person || null }),
      supabase.from('person').select('id,full_name').order('full_name'),
    ]);
    return { d: must(d) as Dash, people: must(people) as { id: string; full_name: string }[] };
  }, [ctx.workspace_id, company, person]);

  if (loading && !data) return <Loading />;
  const d = data?.d;
  const link = (i: Item) => (i.project_id ? `/projecten/${i.project_id}` : '/mijn-taken');
  const today = vandaag();
  return (
    <>
      <div className="row between">
        <h1>Dashboard</h1>
        <div className="row">
          <select aria-label="Bedrijf" value={company} onChange={(e) => setCompany(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">SB en MMS</option>
            {Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select aria-label="Verantwoordelijke" value={person} onChange={(e) => setPerson(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Alle verantwoordelijken</option>
            {data?.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
      </div>
      <Msg>{error}</Msg>
      {d && (
        <>
          {d.phases && (
            <p className="small muted">
              Lopend: {Object.entries(phaseLabel).filter(([k]) => d.phases?.[k]).map(([k, v]) => `${v} ${d.phases?.[k]}`).join(' · ') || 'geen projecten'}
              {d.overdue > 0 && <> · <Pill tone="danger">{d.overdue} taak(en) over de deadline</Pill></>}
            </p>
          )}
          {d.concepts.length > 0 && (
            <Msg kind="info">
              Conceptproject(en) uit Bruto wachten op bevestiging: {d.concepts.map((c, i) => <span key={c.project_id}>{i > 0 && ', '}<Link to={`/projecten/${c.project_id}`}>{c.project}</Link></span>)}
            </Msg>
          )}
          <div className="dash">
            <section className="card" aria-labelledby="h-week">
              <h2 id="h-week">Vandaag en deze week</h2>
              <ul>
                {d.week.map((i) => (
                  <li key={i.type + i.object_id}>
                    <span className="small muted">{dagKort(i.date)}{i.date === today ? ' · vandaag' : ''}</span>{' '}
                    {i.type === 'draaidag' && <Pill tone="ok">Draaidag</Pill>}
                    {i.type === 'deliverable' && isVerlopen(i.date) && <Pill tone="danger">Te laat</Pill>}{' '}
                    <Link to={link(i)}>{i.title}</Link>
                    <div className="small muted">{i.project}</div>
                  </li>
                ))}
                {d.week.length === 0 && <li className="muted">Niets gepland de komende 7 dagen.</li>}
              </ul>
            </section>

            <section className="card" aria-labelledby="h-wacht">
              <h2 id="h-wacht">Wacht op klant</h2>
              <ul>
                {d.waiting_client.map((i) => (
                  <li key={i.object_id}>
                    <Link to={link(i)}>{i.title}</Link> {i.meerwerk && <Pill tone="warn">Mogelijk meerwerk</Pill>}
                    <div className="small muted">{i.project} · in review sinds {dagKort(i.since)}</div>
                  </li>
                ))}
                {d.waiting_client.length === 0 && <li className="muted">Geen versies in review.</li>}
              </ul>
            </section>

            <section className="card" aria-labelledby="h-blok">
              <h2 id="h-blok">Blokkades</h2>
              <ul>
                {d.blockers.map((i, n) => (
                  <li key={n}>
                    <Pill tone={i.type === 'dubbel' ? 'warn' : 'danger'}>{i.type === 'backup' ? 'Back-up' : i.type === 'apparatuur' ? 'Apparatuur' : 'Dubbele boeking'}</Pill>{' '}
                    <Link to={link(i)}>{i.text}</Link>
                    <div className="small muted">{i.project}</div>
                  </li>
                ))}
                {d.blockers.length === 0 && <li className="muted">Geen blokkades.</li>}
              </ul>
            </section>

            {d.finance_visible && (
              <section className="card" aria-labelledby="h-hang">
                <h2 id="h-hang">Blijft hangen</h2>
                <ul>
                  {(d.stale ?? []).map((i, n) => (
                    <li key={n}>
                      <Link to={link(i)}>{i.project}</Link>{' '}
                      {i.over_threshold && <Pill tone="danger">&gt; drempel</Pill>}
                      <div className="small">{i.title} · {i.days ?? 0} dag(en)</div>
                    </li>
                  ))}
                  {(d.stale ?? []).length === 0 && <li className="muted">Niets blijft hangen.</li>}
                </ul>
              </section>
            )}

            <section className="card" aria-labelledby="h-mijn">
              <h2 id="h-mijn">Mijn eerstvolgende acties</h2>
              <ul>
                {d.my_actions.map((i) => (
                  <li key={i.object_id}>
                    <Link to={link(i)}>{i.title}</Link>{' '}
                    {i.deadline && (isVerlopen(i.deadline) ? <Pill tone="danger">{dagKort(i.deadline)}</Pill> : <span className="small muted">{dagKort(i.deadline)}</span>)}
                    {i.project && <div className="small muted">{i.project}</div>}
                  </li>
                ))}
                {d.my_actions.length === 0 && <li className="muted">Geen open taken op jouw naam.{!ctx.person_id && ' (Je account is nog niet aan een persoon gekoppeld.)'}</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
