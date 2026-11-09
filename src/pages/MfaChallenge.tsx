import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Field, Msg } from '../components/ui';

/** Tweede stap bij inloggen: code uit de authenticator-app. Zonder deze stap geeft de database geen gegevens. */
export default function MfaChallenge() {
  const { refresh } = useSession();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const { data: f } = await supabase.auth.mfa.listFactors();
    const factor = f?.totp.find((x) => x.status === 'verified');
    if (!factor) return setErr('Geen authenticator gevonden.');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) return setErr('Code klopt niet of is verlopen. Probeer de nieuwste code.');
    await refresh();
  }
  return (
    <div className="center">
      <form className="auth card" onSubmit={submit}>
        <img src="/brand/regie-woordmerk.png" alt="Regie" />
        <h1>Tweestapsverificatie</h1>
        <Field id="code" label="Code uit je authenticator-app">
          <input id="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Msg>{err}</Msg>
        <div className="row between"><button className="primary">Inloggen</button><button type="button" className="link" onClick={() => supabase.auth.signOut()}>Uitloggen</button></div>
      </form>
    </div>
  );
}
