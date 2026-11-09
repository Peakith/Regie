import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, lifecycleLabel } from '../lib/labels';
import { Loading, Msg, Pill } from '../components/ui';
import type { Person, Project } from './project/types';
import Overzicht from './project/Overzicht';
import Deliverables from './project/Deliverables';
import Draaidagen from './project/Draaidagen';
import Taken from './project/Taken';
import Afronden from './project/Afronden';
import Beheer from './project/Beheer';

const TABS = ['Overzicht', 'Deliverables', 'Draaidagen en crew', 'Taken', 'Afronden', 'Beheer'] as const;

export default function ProjectPagina() {
  const { id } = useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overzicht');
  const { data, error, loading, reload } = useLoad(async () => {
    const [p, edit, manage, people] = await Promise.all([
      supabase.from('project').select('*, client_org(name), project_number(number_display,kind,reason,created_at)').eq('id', id!).maybeSingle(),
      supabase.rpc('can_edit_project', { p_project: id }),
      supabase.rpc('can_manage_project', { p_project: id }),
      supabase.from('person').select('id,full_name,roles').order('full_name'),
    ]);
    return {
      project: must(p) as Project | null, canEdit: Boolean(must(edit)), canManage: Boolean(must(manage)),
      people: must(people) as Person[],
    };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <Msg>{error}</Msg>;
  if (!data?.project) return <Msg>Project niet gevonden, of je hebt er geen toegang toe.</Msg>;

  const p = data.project;
  const number = p.project_number.find((n) => n.kind === 'primair')?.number_display;
  const props = { ...data, project: p, reloadProject: reload };
  const visibleTabs = data.canEdit ? TABS : TABS.filter((t) => t !== 'Beheer');

  return (
    <>
      <p className="small"><Link to="/projecten">← Projecten</Link></p>
      <h1>{number ? `${number} | ` : ''}{p.name}{p.client_org ? ` - ${p.client_org.name}` : ''}</h1>
      <div className="row">
        {!number && <Pill tone="warn">Concept, zonder nummer</Pill>}
        <Pill>{bedrijfLabel[p.company]}</Pill>
        <Pill>Registerjaar {p.year}</Pill>
        <Pill tone={p.lifecycle === 'actief' ? 'info' : p.lifecycle === 'operationeel_afgerond' ? 'ok' : undefined}>{lifecycleLabel[p.lifecycle]}</Pill>
        {p.archived && <Pill>Gearchiveerd</Pill>}
        {p.workflow === 'eenvoudig' && <Pill>Eenvoudig project</Pill>}
        {!data.canEdit && <Pill>Alleen-lezen</Pill>}
      </div>
      <div className="tabs" role="tablist">
        {visibleTabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Overzicht' && <Overzicht {...props} />}
      {tab === 'Deliverables' && <Deliverables {...props} />}
      {tab === 'Draaidagen en crew' && <Draaidagen {...props} />}
      {tab === 'Taken' && <Taken {...props} />}
      {tab === 'Afronden' && <Afronden {...props} />}
      {tab === 'Beheer' && <Beheer {...props} />}
    </>
  );
}
