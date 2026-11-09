import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, errText, must } from '../lib/supabase';
import { canCreateProjects, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { anchorLabel, bedrijfLabel, dagKort, numberStatusLabel, phaseLabel, vandaag } from '../lib/labels';
import { Field, Msg, Pill } from '../components/ui';

type Num = { id: string; number_display: string; company: string; year: number; status: string; name: string | null; client_org_id: string | null };
type Tpl = { id: string; name: string; company: string | null; description: string | null; template_version: { id: string; version_no: number }[] };
type Plan = { kind: string; ord: number; title: string; phase: string | null; anchor: string | null; anchor_offset: number | null; due: string | null };

/**
 * Project aanmaken (§7.7): kies of maak een nummer, kies een template of "leeg", vul klant, verantwoordelijke
 * en het datum-anker in. Je ziet eerst een voorbeeld van wat er wordt aangemaakt en bevestigt dat.
 */
export default function NieuwProject() {
  const ctx = useCtx();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({
    numberMode: params.get('nummer') ? 'bestaand' : 'nieuw', numberId: params.get('nummer') ?? '', company: 'studio_brutaal',
    year: vandaag().slice(0, 4), name: '', clientId: '', clientName: '', contact: '', manager: ctx.person_id ?? '',
    template: '', anchorD: '', anchorS: vandaag(), noShoot: false, briefing: '',
  });
  const [plan, setPlan] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [op] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPlan(null); };

  const { data: lookups } = useLoad(async () => ({
    numbers: must(await supabase.from('project_number').select('id,number_display,company,year,status,name,client_org_id')
      .eq('kind', 'primair').in('status', ['gereserveerd', 'pitch', 'offerte', 'losse_klus']).is('project_id', null)
      .order('number_display', { ascending: false })) as Num[],
    clients: must(await supabase.from('client_org').select('id,name').order('name')) as { id: string; name: string }[],
    people: must(await supabase.from('person').select('id,full_name,user_id').order('full_name')) as { id: string; full_name: string; user_id: string | null }[],
    templates: must(await supabase.from('template').select('id,name,company,description,template_version(id,version_no)').eq('archived', false).order('name')) as Tpl[],
  }), []);

  if (!canCreateProjects(ctx.role)) return <Msg>Je rol mag geen projecten aanmaken.</Msg>;
  const chosenNumber = lookups?.numbers.find((n) => n.id === f.numberId);
  const latest = (t?: Tpl) => t?.template_version.slice().sort((a, b) => b.version_no - a.version_no)[0];
  const tpl = lookups?.templates.find((t) => t.id === f.template);

  async function showPreview(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (f.template && !f.noShoot && !f.anchorD) return setError('Vul de datum van de eerste draaidag in: daar rekenen de deadlines vanaf.');
    if (!f.template) return setPlan([]);
    const { data, error } = await supabase.rpc('template_preview', { p_version: latest(tpl)!.id, p_anchor_d: f.anchorD || f.anchorS, p_anchor_s: f.anchorS });
    if (error) return setError(errText(error));
    setPlan(data as Plan[]);
  }

  async function confirm() {
    setBusy(true); setError('');
    try {
      let numberId = f.numberId;
      if (f.numberMode === 'nieuw') {
        const n = must(await supabase.rpc('issue_number', {
          p_ws: ctx.workspace_id, p_company: f.company, p_year: Number(f.year), p_status: 'offerte', p_name: f.name,
          p_client_org_id: f.clientId && f.clientId !== 'nieuw' ? f.clientId : null, p_client_name: f.clientId === 'nieuw' ? f.clientName : null,
          p_op: op,
        }));
        numberId = n.id;
      }
      const id = must(await supabase.rpc('create_project_from_number', {
        p_number: numberId, p_name: f.name || chosenNumber?.name, p_client_org_id: f.clientId && f.clientId !== 'nieuw' ? f.clientId : null,
        p_client_name: f.clientId === 'nieuw' ? f.clientName : null, p_contact_person_id: f.contact || null,
        p_manager_person_id: f.manager || null, p_template_version: f.template ? latest(tpl)!.id : null,
        p_anchor_d: f.anchorD || null, p_anchor_s: f.anchorS || null, p_no_shoot: f.noShoot, p_briefing: f.briefing || null,
        p_op: crypto.randomUUID(),
      }));
      nav(`/projecten/${id}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={showPreview} style={{ maxWidth: 820 }}>
      <h1>Nieuw project</h1>
      <p className="muted small">Een project ontstaat bij "offerte akkoord". Die mijlpaal wordt bij aanmaken afgevinkt met jouw naam en de datum.</p>
      <div className="grid2">
        <Field id="nm" label="Projectnummer">
          <select id="nm" value={f.numberMode} onChange={set('numberMode')}>
            <option value="nieuw">Nieuw nummer uitgeven</option>
            <option value="bestaand">Bestaand nummer uit het register</option>
          </select>
        </Field>
        {f.numberMode === 'bestaand' ? (
          <Field id="nb" label="Nummer">
            <select id="nb" required value={f.numberId} onChange={(e) => {
              const n = lookups?.numbers.find((x) => x.id === e.target.value);
              setF({ ...f, numberId: e.target.value, name: f.name || n?.name || '', clientId: f.clientId || n?.client_org_id || '' }); setPlan(null);
            }}>
              <option value="">Kies…</option>
              {lookups?.numbers.map((n) => <option key={n.id} value={n.id}>{n.number_display} · {numberStatusLabel[n.status]}{n.name ? ` · ${n.name}` : ''}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field id="company" label="Bedrijf">
              <select id="company" value={f.company} onChange={set('company')}>
                {Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field id="year" label="Jaar van uitgifte" hint="Het nummer houdt dit jaar, ook als de productie over de jaarwisseling loopt.">
              <input id="year" type="number" min={2000} max={2100} required value={f.year} onChange={set('year')} />
            </Field>
          </>
        )}
        <Field id="name" label="Projectnaam"><input id="name" required value={f.name} onChange={set('name')} /></Field>
        <Field id="client" label="Klant">
          <select id="client" value={f.clientId} onChange={set('clientId')}>
            <option value="">Geen klant</option>
            {lookups?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="nieuw">+ Nieuwe klant…</option>
          </select>
        </Field>
        {f.clientId === 'nieuw' && <Field id="clientName" label="Naam nieuwe klant"><input id="clientName" required value={f.clientName} onChange={set('clientName')} /></Field>}
        <Field id="contact" label="Contactpersoon klant">
          <select id="contact" value={f.contact} onChange={set('contact')}>
            <option value="">Nog niet gekozen</option>
            {lookups?.people.filter((p) => !p.user_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field id="manager" label="Verantwoordelijke">
          <select id="manager" value={f.manager} onChange={set('manager')}>
            <option value="">Nog niet gekozen</option>
            {lookups?.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field id="tpl" label="Template">
          <select id="tpl" value={f.template} onChange={set('template')}>
            <option value="">Leeg project</option>
            {lookups?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.company ? ` (${bedrijfLabel[t.company]})` : ''} · v{latest(t)?.version_no}</option>)}
          </select>
        </Field>
        <Field id="as" label="Projectstart (anker S)"><input id="as" type="date" required value={f.anchorS} onChange={set('anchorS')} /></Field>
        {!f.noShoot && <Field id="ad" label="Eerste draaidag (anker D)" hint="Draaidagen mogen in het weekend vallen."><input id="ad" type="date" value={f.anchorD} onChange={set('anchorD')} /></Field>}
      </div>
      {tpl?.description && <p className="small muted">{tpl.description}</p>}
      <div className="field"><label className="inline"><input type="checkbox" checked={f.noShoot} onChange={(e) => { setF({ ...f, noShoot: e.target.checked }); setPlan(null); }} /> Geen opnames (bijv. animatie of montage van bestaand materiaal)</label></div>
      <Field id="briefing" label="Briefing"><textarea id="briefing" value={f.briefing} onChange={set('briefing')} /></Field>
      <Msg>{error}</Msg>

      {plan === null ? (
        <div className="row"><button className="primary">Voorbeeld bekijken</button><button type="button" onClick={() => nav(-1)}>Annuleren</button></div>
      ) : (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <h2>Dit wordt aangemaakt</h2>
          <ul className="plain">
            <li>Project <strong>{f.name || chosenNumber?.name}</strong> met {f.numberMode === 'nieuw' ? `een nieuw ${bedrijfLabel[f.company]}-nummer voor ${f.year}` : <>nummer <strong>{chosenNumber?.number_display}</strong></>}, fase {phaseLabel.pre_productie}</li>
            <li>Mijlpalen: offerte akkoord (afgevinkt), debriefing, gefactureerd, betaling ontvangen, freelancers betaald</li>
            {plan.filter((p) => p.kind === 'draaidag').map((p) => <li key={'d' + p.ord}><Pill tone="ok">Draaidag (optie)</Pill> {p.title} · {dagKort(p.due)}</li>)}
            {plan.filter((p) => p.kind === 'deliverable').map((p) => <li key={'v' + p.ord}><Pill tone="info">Deliverable</Pill> {p.title}</li>)}
            {plan.filter((p) => p.kind === 'taak').map((p) => (
              <li key={'t' + p.ord + p.title}>
                <Pill>{p.phase ? phaseLabel[p.phase] : 'Taak'}</Pill> {p.title}
                <span className="small muted"> · {p.due ? `${dagKort(p.due)} (${p.anchor}${p.anchor_offset! >= 0 ? '+' : ''}${p.anchor_offset} werkdagen t.o.v. ${anchorLabel[p.anchor!]})` : 'geen deadline'}</span>
              </li>
            ))}
            {plan.length === 0 && <li className="muted">Leeg project: geen taken, deliverables of draaidagen.</li>}
          </ul>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="primary" disabled={busy} onClick={confirm}>Bevestigen en aanmaken</button>
            <button type="button" onClick={() => setPlan(null)}>Terug</button>
          </div>
          <p className="hint">Ongedaan maken van de template kan binnen 24 uur via Activiteit (alleen onderdelen die je nog niet hebt gewijzigd).</p>
        </div>
      )}
    </form>
  );
}
