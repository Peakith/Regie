import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { canEditPeople, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { Field, Loading, Msg, Pill } from '../components/ui';

type Person = { id: string; full_name: string; roles: string[]; user_id: string | null; notes: string | null };
type Contact = { person_id: string; email: string | null; phone: string | null };

export default function Personen() {
  const ctx = useCtx();
  const mayEdit = canEditPeople(ctx.role);
  const { data, error, loading, reload } = useLoad(async () => {
    const people = must(await supabase.from('person').select('id,full_name,roles,user_id,notes').order('full_name')) as Person[];
    const contacts = mayEdit ? (must(await supabase.from('person_contact').select('*')) as Contact[]) : [];
    return { people, contacts: new Map(contacts.map((c) => [c.person_id, c])) };
  }, [mayEdit]);

  const [f, setF] = useState({ name: '', roles: '', email: '', phone: '' });
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
        organization_id: ctx.organization_id, full_name: name,
        roles: f.roles.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean),
      }).select().single()) as Person;
      if (email || f.phone.trim()) {
        must(await supabase.from('person_contact').insert({ person_id: p.id, email: email || null, phone: f.phone.trim() || null }).select());
      }
      setF({ name: '', roles: '', email: '', phone: '' });
      setConfirmDup(null);
      await reload();
    } catch (err) {
      setFormErr(errText(err));
    }
  }

  const dupPerson = confirmDup ? data?.people.find((p) => p.id === confirmDup) : null;
  return (
    <>
      <h1>Personen</h1>
      <p className="muted">Crew, editors, freelancers en contactpersonen. Een persoon heeft niet automatisch een account: inplannen geeft geen toegang en verstuurt geen uitnodiging.</p>
      {mayEdit && (
        <form className="card" onSubmit={submit}>
          <h2>Persoon toevoegen</h2>
          <div className="grid2">
            <Field id="pn" label="Naam"><input id="pn" required value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setConfirmDup(null); }} /></Field>
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
      {loading && !data ? <Loading /> : (
        <table className="list">
          <thead><tr><th>Naam</th><th>Vakrollen</th><th>Account</th>{mayEdit && <th>Contact</th>}</tr></thead>
          <tbody>
            {data?.people.map((p) => {
              const c = data.contacts.get(p.id);
              return (
                <tr key={p.id}>
                  <td data-label="Naam"><strong>{p.full_name}</strong></td>
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
