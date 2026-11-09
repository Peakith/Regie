import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, dagKort, deliverableStatusLabel, isVerlopen } from '../lib/labels';
import { Loading, Msg, Pill } from '../components/ui';

type D = { id: string; title: string; status: string; deadline: string | null; aspect_ratio: string | null; project_id: string; is_extra_work: boolean;
  responsible_person_id: string | null; project: { name: string; company: string; archived: boolean; client_org: { name: string } | null } };

const COLS = ['gepland', 'in_uitvoering', 'in_review', 'wijzigingen_nodig', 'goedgekeurd', 'geleverd'];

/** Deliverables-bord over alle projecten (§7.5), filterbaar per project, bedrijf, klant en verantwoordelijke. */
export default function Bord() {
  const [f, setF] = useState({ project: '', company: '', client: '', person: '', from: '', to: '' });
  const { data, error, loading } = useLoad(async () => ({
    d: must(await supabase.from('deliverable').select('id,title,status,deadline,aspect_ratio,project_id,is_extra_work,responsible_person_id,project!inner(name,company,archived,client_org(name))')
      .eq('project.archived', false).neq('status', 'vervallen').order('deadline', { ascending: true, nullsFirst: false })) as D[],
    people: must(await supabase.from('person').select('id,full_name').order('full_name')) as { id: string; full_name: string }[],
  }), []);
  if (loading && !data) return <Loading />;
  const all = data?.d ?? [];
  const projects = [...new Map(all.map((d) => [d.project_id, d.project.name])).entries()];
  const clients = [...new Set(all.map((d) => d.project.client_org?.name).filter(Boolean))] as string[];
  const rows = all.filter((d) => (!f.project || d.project_id === f.project) && (!f.company || d.project.company === f.company)
    && (!f.client || d.project.client_org?.name === f.client) && (!f.person || d.responsible_person_id === f.person)
    && (!f.from || (d.deadline ?? '') >= f.from) && (!f.to || (d.deadline ?? '9999') <= f.to));
  return (
    <>
      <h1>Deliverables</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Project" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} style={{ maxWidth: 240 }}>
          <option value="">Alle projecten</option>{projects.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select aria-label="Bedrijf" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} style={{ maxWidth: 180 }}>
          <option value="">Alle bedrijven</option>{Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Klant" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} style={{ maxWidth: 200 }}>
          <option value="">Alle klanten</option>{clients.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Verantwoordelijke" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} style={{ maxWidth: 200 }}>
          <option value="">Alle verantwoordelijken</option>{data?.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <label className="inline">Deadline van <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ maxWidth: 160 }} /></label>
        <label className="inline">tot <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ maxWidth: 160 }} /></label>
      </div>
      <Msg>{error}</Msg>
      <div className="board">
        {COLS.map((c) => (
          <div key={c} className="col">
            <h3>{deliverableStatusLabel[c]} ({rows.filter((d) => d.status === c).length})</h3>
            {rows.filter((d) => d.status === c).map((d) => (
              <Link key={d.id} to={`/projecten/${d.project_id}?tab=Deliverables`} className="item" style={{ display: 'block', textDecoration: 'none' }}>
                <strong>{d.title}</strong> {d.aspect_ratio && <span className="small muted">{d.aspect_ratio}</span>}
                <div className="small muted">{d.project.name}{d.project.client_org ? ` – ${d.project.client_org.name}` : ''}</div>
                {d.deadline && <div className="small">{isVerlopen(d.deadline) && c !== 'geleverd' ? <Pill tone="danger">{dagKort(d.deadline)}</Pill> : dagKort(d.deadline)}</div>}
                {d.is_extra_work && <Pill tone="warn">Meerwerk</Pill>}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
