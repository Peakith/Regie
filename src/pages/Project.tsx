import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { canApprove, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, financeLabel, lifecycleLabel, phaseLabel, riskLabel, riskTone } from '../lib/labels';
import { Loading, Msg, PhaseBar, Pill, Source } from '../components/ui';
import type { Person, Project, Status } from './project/types';
import Overzicht from './project/Overzicht';
import Deliverables from './project/Deliverables';
import Draaidagen from './project/Draaidagen';
import Taken from './project/Taken';
import Besluiten from './project/Besluiten';
import Links from './project/Links';
import Activiteit from './project/Activiteit';

const TABS = ['Overzicht', 'Deliverables', 'Draaidagen', 'Taken', 'Besluiten', 'Bestanden & links', 'Activiteit'] as const;

export default function ProjectPagina() {
  const { id } = useParams();
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as (typeof TABS)[number]) : 'Overzicht';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });
  const { data, error, loading, reload } = useLoad(async () => {
    const [p, edit, manage, people, status] = await Promise.all([
      supabase.from('project').select('*, client_org(name), template_version(version_no, template(name)), project_number(id,number_display,kind,reason,created_at,source)').eq('id', id!).maybeSingle(),
      supabase.rpc('can_edit_project', { p_project: id }),
      supabase.rpc('can_manage_project', { p_project: id }),
      supabase.from('person').select('id,full_name,roles,user_id').order('full_name'),
      supabase.rpc('project_status', { p_project: id }),
    ]);
    const project = must(p) as Project | null;
    return {
      project, canEdit: Boolean(must(edit)), canManage: Boolean(must(manage)) && !project?.archived,
      people: must(people) as Person[], status: project ? (must(status) as Status) : null,
    };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Msg>{error}</Msg>;
  if (!data?.project || !data.status) return <Msg>Project niet gevonden, of je hebt er geen toegang toe.</Msg>;

  const p = data.project;
  const s = data.status;
  const number = p.project_number.find((n) => n.kind === 'primair')?.number_display;
  const manager = data.people.find((x) => x.id === p.manager_person_id)?.full_name;
  const props = { ...data, project: p, status: s, canApprove: canApprove(ctx.role) && data.canEdit, reloadProject: reload };

  return (
    <>
      <p className="small"><Link to="/projecten">← Projecten</Link></p>
      <h1>{number ? `${number} | ` : ''}{p.name}{p.client_org ? ` – ${p.client_org.name}` : ''}</h1>
      <div className="row" style={{ marginBottom: 8 }}>
        <Pill>{bedrijfLabel[p.company]}</Pill>
        <Pill>{p.year}</Pill>
        {p.is_concept && <Pill tone="warn">Concept ter bevestiging</Pill>}
        <Pill tone="info">{phaseLabel[s.phase]}</Pill>
        {s.phase_mode === 'handmatig' && <Pill tone="warn">Fase handmatig</Pill>}
        {!p.archived && <Pill tone={riskTone(s.risk)}>{riskLabel[s.risk]}</Pill>}
        {s.finance && <Pill tone={s.finance.status === 'betaald' ? 'ok' : undefined}>{financeLabel[s.finance.status]}{s.finance.freelancers_van_toepassing ? (s.finance.freelancers_betaald ? ' · freelancers betaald' : ' · freelancers open') : ''}</Pill>}
        {p.lifecycle !== 'actief' && p.lifecycle !== 'operationeel_afgerond' && <Pill>{lifecycleLabel[p.lifecycle]}</Pill>}
        {p.archived && <Pill>Gearchiveerd · alleen-lezen</Pill>}
        <span className="small muted">Verantwoordelijke: {manager ?? 'niet gekozen'}</span>
      </div>
      <PhaseBar phase={s.phase} />
      <p className="small muted" style={{ marginTop: 6 }}>
        Fase, deliverables, draaidagen en taken <Source kind="hier" /> · klant en offerte {p.project_number.some((n) => n.source === 'bruto') ? <Source kind="bruto" /> : <Source kind="hier" />}
        {' '}· bestanden <Source kind="link" /> · Dropbox en Moneybird <Source kind="inactief" />
        {p.template_version && <> · template {p.template_version.template.name} v{p.template_version.version_no}</>}
      </p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'Overzicht' && <Overzicht {...props} goTab={setTab} />}
      {tab === 'Deliverables' && <Deliverables {...props} />}
      {tab === 'Draaidagen' && <Draaidagen {...props} />}
      {tab === 'Taken' && <Taken {...props} />}
      {tab === 'Besluiten' && <Besluiten {...props} />}
      {tab === 'Bestanden & links' && <Links {...props} />}
      {tab === 'Activiteit' && <Activiteit {...props} />}
    </>
  );
}
