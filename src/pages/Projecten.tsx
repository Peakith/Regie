import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { canCreateProjects, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, datum, isVerlopen, lifecycleLabel } from '../lib/labels';
import { Loading, Msg, Pill } from '../components/ui';

type Row = {
  id: string; number: string | null; name: string; client_name: string | null; company: string; year: number;
  lifecycle: string; archived: boolean; manager_name: string | null; editors: string[]; crew_count: number;
  deliverables_total: number; deliverables_delivered: number; deliverables_without_editor: number;
  next_shoot_date: string | null; next_deadline: string | null;
};

export default function Projecten() {
  const ctx = useCtx();
  const [bedrijf, setBedrijf] = useState('');
  const [status, setStatus] = useState('lopend');
  const [jaar, setJaar] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad(async () =>
    must(await supabase.from('project_overview').select('*').eq('workspace_id', ctx.workspace_id)
      .order('year', { ascending: false }).order('number', { ascending: false, nullsFirst: true })) as Row[], [ctx.workspace_id]);

  const jaren = useMemo(() => [...new Set((data ?? []).map((r) => r.year))].sort((a, b) => b - a), [data]);
  const rows = (data ?? []).filter((r) => {
    if (bedrijf && r.company !== bedrijf) return false;
    if (jaar && String(r.year) !== jaar) return false;
    if (status === 'lopend' && (r.archived || !['actief', 'gepauzeerd'].includes(r.lifecycle))) return false;
    if (status === 'gearchiveerd' && !r.archived) return false;
    if (!['lopend', 'alle', 'gearchiveerd'].includes(status) && (r.lifecycle !== status || r.archived)) return false;
    const hay = `${r.number ?? ''} ${r.name} ${r.client_name ?? ''}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase()) || hay.replace(/\s/g, '').includes(q.toLowerCase().replace(/\s/g, ''));
  });

  return (
    <>
      <div className="row between">
        <h1>Projecten</h1>
        {canCreateProjects(ctx.role) && <Link className="btn primary" to="/projecten/nieuw">Nieuw project</Link>}
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <input aria-label="Zoeken op nummer, naam of klant" placeholder="Zoek op nummer, naam of klant" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select aria-label="Bedrijf" value={bedrijf} onChange={(e) => setBedrijf(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Alle bedrijven</option>
          {Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 300 }}>
          <option value="lopend">Lopend (actief en gepauzeerd)</option>
          <option value="alle">Alle statussen, inclusief archief</option>
          {Object.entries(lifecycleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="gearchiveerd">Gearchiveerd</option>
        </select>
        <select aria-label="Registerjaar" value={jaar} onChange={(e) => setJaar(e.target.value)} style={{ maxWidth: 140 }}>
          <option value="">Alle jaren</option>
          {jaren.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>
      <Msg>{error}</Msg>
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <div className="card muted">Geen projecten gevonden voor deze filters.</div>
      ) : (
        <table className="list">
          <thead><tr>
            <th>Nummer</th><th>Project</th><th>Bedrijf</th><th>Status</th><th>Editors</th><th>Crew</th>
            <th>Volgende draaidag</th><th>Eerstvolgende deadline</th><th>Geleverd</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Nummer">{r.number ?? <Pill tone="warn">Concept, zonder nummer</Pill>}</td>
                <td data-label="Project"><Link to={`/projecten/${r.id}`}>{r.name}</Link><div className="small muted">{r.client_name ?? 'Geen klant'} · {r.year}</div></td>
                <td data-label="Bedrijf">{bedrijfLabel[r.company]}</td>
                <td data-label="Status">
                  <Pill tone={r.lifecycle === 'actief' ? 'info' : r.lifecycle === 'operationeel_afgerond' ? 'ok' : undefined}>{lifecycleLabel[r.lifecycle]}</Pill>
                  {r.archived && <> <Pill>Archief</Pill></>}
                </td>
                <td data-label="Editors">
                  {r.editors.length ? r.editors.join(', ') : <span className="muted">—</span>}
                  {r.deliverables_without_editor > 0 && <div><Pill tone="warn">{r.deliverables_without_editor} zonder editor</Pill></div>}
                </td>
                <td data-label="Crew">{r.crew_count || '—'}</td>
                <td data-label="Volgende draaidag">{datum(r.next_shoot_date)}</td>
                <td data-label="Eerstvolgende deadline">
                  {isVerlopen(r.next_deadline) ? <Pill tone="danger">Verlopen: {datum(r.next_deadline)}</Pill> : datum(r.next_deadline)}
                </td>
                <td data-label="Geleverd">{r.deliverables_total ? `${r.deliverables_delivered}/${r.deliverables_total}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
