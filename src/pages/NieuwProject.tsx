import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, errText, must } from '../lib/supabase';
import { canCreateProjects, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, nummerWaarschuwing } from '../lib/labels';
import { Field, Msg } from '../components/ui';

export default function NieuwProject() {
  const ctx = useCtx();
  const nav = useNavigate();
  const [f, setF] = useState({
    company: 'studio_brutaal', year: String(new Date().getFullYear()), number: '', name: '',
    clientId: '', clientName: '', manager: ctx.person_id ?? '', workflow: 'film', production: true, briefing: '',
  });
  const [inUse, setInUse] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const { data: lookups } = useLoad(async () => ({
    clients: must(await supabase.from('client_org').select('id,name').order('name')) as { id: string; name: string }[],
    people: must(await supabase.from('person').select('id,full_name').order('full_name')) as { id: string; full_name: string }[],
  }), []);

  if (!canCreateProjects(ctx.role)) return <Msg>Je rol mag geen projecten aanmaken.</Msg>;

  async function checkNumber() {
    if (!f.number.trim()) return setInUse(false);
    const { data } = await supabase.rpc('number_in_use', { p_org: ctx.organization_id, p_number: f.number });
    setInUse(Boolean(data));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { data, error } = await supabase.rpc('create_project', {
      p_ws: ctx.workspace_id, p_company: f.company, p_year: Number(f.year), p_name: f.name,
      p_number: f.number.trim() ? f.number : null,
      p_client_org_id: f.clientId && f.clientId !== 'nieuw' ? f.clientId : null,
      p_client_name: f.clientId === 'nieuw' ? f.clientName : null,
      p_manager_person_id: f.manager || null, p_briefing: f.briefing || null,
      p_workflow: f.workflow, p_production_applicable: f.workflow === 'film' && f.production,
    });
    setBusy(false);
    if (error) return setError(errText(error));
    nav(`/projecten/${data}`);
  }

  const warn = nummerWaarschuwing(f.number);
  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 720 }}>
      <h1>Nieuw project</h1>
      <div className="grid2">
        <Field id="company" label="Bedrijf">
          <select id="company" value={f.company} onChange={set('company')}>
            {Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field id="year" label="Registerjaar" hint="Voorstel: het startjaar. Aanpasbaar, en verandert niet op 1 januari.">
          <input id="year" type="number" min={2000} max={2100} required value={f.year} onChange={set('year')} />
        </Field>
        <Field id="number" label="Projectnummer (optioneel)" hint="Zonder nummer wordt het een concept. Je voert het nummer zelf in; Regie geeft geen nummers uit.">
          <input id="number" value={f.number} onChange={set('number')} onBlur={checkNumber} placeholder="bijv. SB26130" />
        </Field>
        <Field id="name" label="Projectnaam">
          <input id="name" required value={f.name} onChange={set('name')} />
        </Field>
      </div>
      {warn && <Msg kind="warn">{warn}</Msg>}
      {inUse && <Msg>Dit nummer is al geregistreerd en kan niet opnieuw worden gebruikt.</Msg>}
      <div className="grid2">
        <Field id="client" label="Klant">
          <select id="client" value={f.clientId} onChange={set('clientId')}>
            <option value="">Geen klant</option>
            {lookups?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="nieuw">+ Nieuwe klant…</option>
          </select>
        </Field>
        {f.clientId === 'nieuw' && (
          <Field id="clientName" label="Naam nieuwe klant">
            <input id="clientName" required value={f.clientName} onChange={set('clientName')} />
          </Field>
        )}
        <Field id="manager" label="Projectverantwoordelijke">
          <select id="manager" value={f.manager} onChange={set('manager')}>
            <option value="">Nog niet gekozen</option>
            {lookups?.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field id="workflow" label="Soort project" hint="Een eenvoudig project heeft geen deliverables of draaidagen nodig en sluit je handmatig af.">
          <select id="workflow" value={f.workflow} onChange={set('workflow')}>
            <option value="film">Filmproductie</option>
            <option value="eenvoudig">Eenvoudig (alleen taken)</option>
          </select>
        </Field>
      </div>
      {f.workflow === 'film' && (
        <div className="field">
          <label className="inline"><input type="checkbox" checked={f.production} onChange={(e) => setF({ ...f, production: e.target.checked })} /> Dit project heeft draaidagen (productie)</label>
        </div>
      )}
      <Field id="briefing" label="Briefing">
        <textarea id="briefing" value={f.briefing} onChange={set('briefing')} />
      </Field>
      <Msg>{error}</Msg>
      <div className="row">
        <button className="primary" disabled={busy || inUse}>Project aanmaken</button>
        <button type="button" onClick={() => nav('/projecten')}>Annuleren</button>
      </div>
    </form>
  );
}
