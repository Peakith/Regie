import { useState } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { isOwnerOrAdmin, useCtx } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';
import { adminStatusLabel, datumTijd, lifecycleLabel } from '../../lib/labels';
import { Loading, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type Gate = { severity: 'blokkade' | 'waarschuwing'; code: string; message: string; object_type: string; object_id: string };

export default function Afronden({ project, canManage, reloadProject }: TabProps) {
  const ctx = useCtx();
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.rpc('close_gates', { p_project: project.id })) as Gate[], [project.id, project.revision]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [adm, setAdm] = useState({
    status: project.admin_status, factuur: project.adm_factuur_verstuurd, betaling: project.adm_betaling_ontvangen,
    freelancers: project.adm_freelancers_betaald, overig: project.adm_overig_afgerond,
  });

  const blocks = (data ?? []).filter((g) => g.severity === 'blokkade');
  const warns = (data ?? []).filter((g) => g.severity === 'waarschuwing');
  const open = ['actief', 'gepauzeerd'].includes(project.lifecycle);

  async function act(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    const { error } = await fn();
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: ok });
    await reloadProject();
    await reload();
  }
  function lifecycle(to: string, question: string) {
    const r = prompt(question);
    if (r?.trim()) void act(() => supabase.rpc('set_project_lifecycle', { p_project: project.id, p_lifecycle: to, p_reason: r }), 'Status gewijzigd.');
  }

  return (
    <>
      <div className="card">
        <h2>Operationeel afsluiten</h2>
        <p className="muted small">Afsluiten kan pas als alle overeengekomen deliverables met de vereiste versie zijn goedgekeurd en geleverd (of gemotiveerd vervallen), draaidagen zijn uitgevoerd met bevestigde back-up, en verplichte afsluittaken klaar zijn. Administratie is een aparte controle.</p>
        <p>Huidige status: <Pill tone={project.lifecycle === 'operationeel_afgerond' ? 'ok' : 'info'}>{lifecycleLabel[project.lifecycle]}</Pill>
          {project.closed_at && <span className="small muted"> sinds {datumTijd(project.closed_at)}</span>}
          {project.lifecycle_reason && <span className="small muted"> · reden: {project.lifecycle_reason}</span>}
        </p>
        <Msg>{error}</Msg>
        {loading && !data ? <Loading /> : open && (
          blocks.length === 0
            ? <Msg kind="ok">Alle afsluitvoorwaarden zijn vervuld.</Msg>
            : <div className="msg error" role="status"><strong>Nog niet klaar om af te sluiten:</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{blocks.map((g) => <li key={g.code + g.object_id}>{g.message}</li>)}</ul></div>
        )}
        {open && warns.length > 0 && (
          <div className="msg warn"><strong>Let op (blokkeert niet):</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warns.map((g) => <li key={g.object_id}>{g.message}</li>)}</ul></div>
        )}
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        {canManage && (
          <div className="row">
            {open && (
              <button className="primary" disabled={blocks.length > 0}
                onClick={() => { if (confirm('Project operationeel afsluiten? Je naam en tijdstip worden vastgelegd.')) void act(() => supabase.rpc('close_project', { p_project: project.id }), 'Project is operationeel afgesloten.'); }}>
                Operationeel afsluiten
              </button>
            )}
            {project.lifecycle === 'actief' && <button onClick={() => lifecycle('gepauzeerd', 'Waarom pauzeer je dit project?')}>Pauzeren</button>}
            {project.lifecycle !== 'actief' && <button onClick={() => lifecycle('actief', project.lifecycle === 'operationeel_afgerond' ? 'Waarom heropen je dit project? (bijv. goedgekeurd meerwerk)' : 'Waarom wordt dit project weer actief?')}>
              {project.lifecycle === 'operationeel_afgerond' ? 'Heropenen' : 'Weer actief maken'}
            </button>}
            {project.lifecycle !== 'geannuleerd' && <button className="danger" onClick={() => lifecycle('geannuleerd', 'Waarom wordt dit project geannuleerd? Nummer en historie blijven bewaard.')}>Annuleren</button>}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Administratieve afronding</h2>
        <p className="muted small">Handmatige controle; geen bedragen. Budgetten en facturen staan in Bruto en Moneybird.</p>
        <p>Status: <Pill tone={project.admin_status === 'afgerond' ? 'ok' : project.admin_status === 'open' ? 'warn' : undefined}>{adminStatusLabel[project.admin_status]}</Pill>
          {project.adm_checked_at && <span className="small muted"> · laatst gecontroleerd {datumTijd(project.adm_checked_at)}</span>}
        </p>
        <fieldset disabled={!isOwnerOrAdmin(ctx.role)} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          <label className="inline"><input type="checkbox" checked={adm.factuur} onChange={(e) => setAdm({ ...adm, factuur: e.target.checked })} /> Factuur verstuurd</label>
          <label className="inline"><input type="checkbox" checked={adm.betaling} onChange={(e) => setAdm({ ...adm, betaling: e.target.checked })} /> Betaling ontvangen</label>
          <label className="inline"><input type="checkbox" checked={adm.freelancers} onChange={(e) => setAdm({ ...adm, freelancers: e.target.checked })} /> Freelancers betaald</label>
          <label className="inline"><input type="checkbox" checked={adm.overig} onChange={(e) => setAdm({ ...adm, overig: e.target.checked })} /> Overige verplichtingen afgehandeld</label>
          <div className="row">
            <select aria-label="Administratieve status" value={adm.status} onChange={(e) => setAdm({ ...adm, status: e.target.value })} style={{ maxWidth: 240 }}>
              {Object.entries(adminStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={() => act(() => supabase.rpc('set_admin_status', {
              p_project: project.id, p_status: adm.status, p_factuur: adm.factuur, p_betaling: adm.betaling,
              p_freelancers: adm.freelancers, p_overig: adm.overig,
            }), 'Administratieve controle opgeslagen.')}>Opslaan</button>
          </div>
        </fieldset>
        {!isOwnerOrAdmin(ctx.role) && <p className="hint">Alleen eigenaar of admin beheert de administratieve afronding.</p>}
      </div>
    </>
  );
}
