import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { canEditPeople, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { Field, Loading, Msg, Pill } from '../components/ui';

type Person = { id: string; full_name: string; roles: string[]; user_id: string | null; notes: string | null; kind: string | null; client_org_id: string | null };
type Contact = { person_id: string; email: string | null; phone: string | null };

export default function Personen() {
  const [tab, setTab] = useState<'personen' | 'klanten'>('personen');
  return (
    <>
      <h1>Personen & klanten</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'personen'} onClick={() => setTab('personen')}>Personen</button>
        <button role="tab" aria-selected={tab === 'klanten'} onClick={() => setTab('klanten')}>Klanten</button>
      </div>
      {tab === 'personen' ? <PersonenLijst /> : <Klanten />}
    </>
  );
}

type Client = { id: string; name: string; kvk: string | null; notes: string | null; bruto_client_id: string | null };

function Klanten() {
  const ctx = useCtx();
  const mayEdit = canEditPeople(ctx.role);
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from('client_org').select('id,name,kvk,notes,bruto_client_id').order('name')) as Client[], []);
  const [f, setF] = useState({ name: '', kvk: '', notes: '' });
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    if (data?.some((c) => c.name.toLowerCase() === f.name.trim().toLowerCase()) && !confirm('Er bestaat al een klant met deze naam. Toch toevoegen?')) return;
    const { error } = await supabase.from('client_org').insert({ organization_id: ctx.organization_id, name: f.name.trim(), kvk: f.kvk || null, notes: f.notes || null });
    if (error) return setErr(errText(error));
    setF({ name: '', kvk: '', notes: '' }); setErr('');
    await reload();
  }
  async function save(c: Client, patch: Partial<Client>) {
    const { error } = await supabase.from('client_org').update(patch).eq('id', c.id);
    setErr(error ? errText(error) : '');
    await reload();
  }
  return (
    <>
      <p className="muted small">Klantgegevens zijn leidend in Bruto; hier staat wat Regie nodig heeft. Klanten hebben geen toegang tot Regie.</p>
      <Msg>{error}</Msg><Msg>{err}</Msg>
      {mayEdit && (
        <form className="card" onSubmit={add}>
          <h2>Klant toevoegen</h2>
          <div className="grid2">
            <Field id="kn" label="Naam"><input id="kn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field id="kk" label="KvK (optioneel)"><input id="kk" value={f.kvk} onChange={(e) => setF({ ...f, kvk: e.target.value })} /></Field>
            <Field id="kno" label="Notitie"><input id="kno" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <button className="primary">Toevoegen</button>
        </form>
      )}
      {loading && !data ? <Loading /> : (
        <table className="list">
          <thead><tr><th>Klant</th><th>KvK</th><th>Notitie</th><th>Bruto</th></tr></thead>
          <tbody>
            {data?.map((c) => (
              <tr key={c.id}>
                <td data-label="Klant"><strong>{c.name}</strong></td>
                <td data-label="KvK">{mayEdit ? <input aria-label={`KvK ${c.name}`} defaultValue={c.kvk ?? ''} onBlur={(e) => e.target.value !== (c.kvk ?? '') && save(c, { kvk: e.target.value || null })} /> : c.kvk ?? '—'}</td>
                <td data-label="Notitie">{mayEdit ? <input aria-label={`Notitie ${c.name}`} defaultValue={c.notes ?? ''} onBlur={(e) => e.target.value !== (c.notes ?? '') && save(c, { notes: e.target.value || null })} /> : c.notes ?? '—'}</td>
                <td data-label="Bruto">{c.bruto_client_id ? <Pill tone="info">Gekoppeld</Pill> : <span className="muted small">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function PersonenLijst() {
  const ctx = useCtx();
  const mayEdit = canEditPeople(ctx.role);
  const { data, error, loading, reload } = useLoad(async () => {
    const people = must(await supabase.from('person').select('id,full_name,roles,user_id,notes,kind,client_org_id').order('full_name')) as Person[];
    const contacts = mayEdit ? (must(await supabase.from('person_contact').select('*')) as Contact[]) : [];
    const clients = must(await supabase.from('client_org').select('id,name').order('name')) as { id: string; name: string }[];
    return { people, contacts: new Map(contacts.map((c) => [c.person_id, c])), clients };
  }, [mayEdit]);

  const [f, setF] = useState({ name: '', roles: '', email: '', phone: '', kind: 'freelancer', client: '' });
  const [kindFilter, setKindFilter] = useState('');
  const [formErr, setFormErr] = useState('');
  const [confirmDup, setConfirmDup] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormErr('');
    const name = f.name.trim();
    const email = f.email.trim().toLowerCase();
    const dup = data?.people.find((p) => p.full_name.toLowerCase() === name.toLowerCase()
      || (email && data.contacts.get(p.id)?.email?.toLowerCase() === email));
    if (dup && confirmDup !== dup.id) {
      setConfirmDup(dup.id);
      return;
    }
    try {
      const p = must(await supabase.from('person').insert({
        organization_id: ctx.organization_id, full_name: name, kind: f.kind, client_org_id: f.kind === 'klantcontact' ? f.client || null : null,
        roles: f.roles.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean),
      }).select().single()) as Person;
      if (email || f.phone.trim()) {
        must(await supabase.from('person_contact').insert({ person_id: p.id, email: email || null, phone: f.phone.trim() || null }).select());
      }
      setF({ name: '', roles: '', email: '', phone: '', kind: f.kind, client: '' });
      setConfirmDup(null);
      await reload();
    } catch (err) {
      setFormErr(errText(err));
    }
  }

  const dupPerson = confirmDup ? data?.people.find((p) => p.id === confirmDup) : null;
  return (
    <>
      <p className="muted">Crew, editors, freelancers en contactpersonen. Een persoon heeft niet automatisch een account: inplannen geeft geen toegang en verstuurt geen uitnodiging.</p>
      {mayEdit && (
        <form className="card" onSubmit={submit}>
          <h2>Persoon toevoegen</h2>
          <div className="grid2">
            <Field id="pn" label="Naam"><input id="pn" required value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setConfirmDup(null); }} /></Field>
            <Field id="pk" label="Type">
              <select id="pk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="freelancer">Freelancer</option><option value="intern">Intern</option>
                <option value="klantcontact">Klantcontact</option><option value="overig">Overig</option>
              </select>
            </Field>
            {f.kind === 'klantcontact' && (
              <Field id="pkc" label="Klant">
                <select id="pkc" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
                  <option value="">Kies klant…</option>{data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <Field id="pr" label="Vakrollen" hint="Komma-gescheiden, bijv. editor, camera, geluid"><input id="pr" value={f.roles} onChange={(e) => setF({ ...f, roles: e.target.value })} /></Field>
            <Field id="pe" label="E-mail (optioneel)"><input id="pe" type="email" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setConfirmDup(null); }} /></Field>
            <Field id="pt" label="Telefoon (optioneel)"><input id="pt" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          {dupPerson && (
            <Msg kind="warn">Er bestaat al een persoon die hierop lijkt: <strong>{dupPerson.full_name}</strong>. Een gelijke naam of e-mail bewijst niet dat het dezelfde persoon is. Klik nogmaals op Toevoegen om toch een nieuwe persoon te maken.</Msg>
          )}
          <Msg>{formErr}</Msg>
          <button className="primary">Toevoegen</button>
        </form>
      )}
      <Msg>{error}</Msg>
      <select aria-label="Filter type" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ maxWidth: 200, marginBottom: 10 }}>
        <option value="">Alle typen</option><option value="intern">Intern</option><option value="freelancer">Freelancer</option>
        <option value="klantcontact">Klantcontact</option><option value="overig">Overig</option>
      </select>
      {loading && !data ? <Loading /> : (
        <table className="list">
          <thead><tr><th>Naam</th><th>Type</th><th>Vakrollen</th><th>Account</th>{mayEdit && <th>Contact</th>}</tr></thead>
          <tbody>
            {data?.people.filter((p) => !kindFilter || p.kind === kindFilter).map((p) => {
              const c = data.contacts.get(p.id);
              return (
                <tr key={p.id}>
                  <td data-label="Naam"><strong>{p.full_name}</strong></td>
                  <td data-label="Type">{p.kind ?? '—'}{p.client_org_id && <div className="small muted">{data.clients.find((c) => c.id === p.client_org_id)?.name}</div>}</td>
                  <td data-label="Vakrollen">{p.roles.length ? p.roles.join(', ') : '—'}</td>
                  <td data-label="Account">{p.user_id ? <Pill tone="info">Heeft account</Pill> : <span className="muted">Geen account</span>}</td>
                  {mayEdit && <td data-label="Contact" className="small">{[c?.email, c?.phone].filter(Boolean).join(' · ') || '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
