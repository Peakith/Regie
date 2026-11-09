import { useState, type FormEvent } from 'react';
import { supabase, errText } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Field, Msg } from '../components/ui';

export default function Inrichten() {
  const { refresh } = useSession();
  const [org, setOrg] = useState('');
  const [ws, setWs] = useState('Producties');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('bootstrap_organization', { p_org_name: org, p_workspace_name: ws, p_full_name: name });
    setBusy(false);
    if (error) return setError(errText(error));
    await refresh();
  }

  return (
    <div className="center">
      <form className="auth card" onSubmit={submit}>
        <img src="/brand/regie-woordmerk.png" alt="Regie" />
        <h1>Regie inrichten</h1>
        <p className="muted">Eenmalig: je wordt eigenaar van de organisatie en de eerste werkruimte.</p>
        <Field id="org" label="Naam organisatie"><input id="org" required value={org} onChange={(e) => setOrg(e.target.value)} /></Field>
        <Field id="ws" label="Naam werkruimte" hint="Studio Brutaal en Moviemates delen één werkruimte; het bedrijf kies je per project.">
          <input id="ws" required value={ws} onChange={(e) => setWs(e.target.value)} />
        </Field>
        <Field id="nm" label="Jouw naam"><input id="nm" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Msg>{error}</Msg>
        <button className="primary" disabled={busy}>Inrichten</button>
      </form>
    </div>
  );
}
