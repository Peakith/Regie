import { useState, type FormEvent } from 'react';
import { supabase, errText } from '../lib/supabase';
import { Field, Msg } from '../components/ui';

export default function Login() {
  const [mode, setMode] = useState<'in' | 'nieuw'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (res.error) setError(errText(res.error));
    setBusy(false);
  }

  return (
    <div className="center">
      <form className="auth card" onSubmit={submit}>
        <img src="/brand/regie-woordmerk.png" alt="Regie" />
        <h1>{mode === 'in' ? 'Inloggen' : 'Account aanmaken'}</h1>
        <Field id="email" label="E-mailadres">
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="pw" label="Wachtwoord" hint={mode === 'nieuw' ? 'Minimaal 8 tekens.' : undefined}>
          <input id="pw" type="password" minLength={mode === 'nieuw' ? 8 : undefined} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Msg>{error}</Msg>
        <div className="row between">
          <button className="primary" disabled={busy}>{mode === 'in' ? 'Inloggen' : 'Account aanmaken'}</button>
          <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'nieuw' : 'in')}>
            {mode === 'in' ? 'Account aanmaken' : 'Ik heb al een account'}
          </button>
        </div>
        {mode === 'nieuw' && (
          <p className="hint">
            Een nieuw account krijgt pas toegang met een uitnodigingslink van de eigenaar. Gebruik het e-mailadres waarop je bent uitgenodigd
            en open daarna de uitnodigingslink opnieuw.
          </p>
        )}
      </form>
    </div>
  );
}
