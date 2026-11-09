import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, errText } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Msg } from '../components/ui';

/** Uitnodiging accepteren: eenmalige link, 7 dagen geldig, alleen voor het uitgenodigde e-mailadres. */
export default function Uitnodiging() {
  const { session, refresh } = useSession();
  const nav = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    const { error } = await supabase.rpc('accept_invitation', { p_token: token });
    setBusy(false);
    if (error) return setErr(errText(error));
    await refresh();
    nav('/');
  }
  return (
    <div className="center">
      <div className="auth card">
        <img src="/brand/regie-woordmerk.png" alt="Regie" />
        <h1>Uitnodiging</h1>
        <p>Je bent ingelogd als <strong>{session?.user.email}</strong>. Accepteer de uitnodiging om toegang te krijgen.</p>
        <Msg>{err}</Msg>
        <div className="row"><button className="primary" disabled={busy || !token} onClick={accept}>Uitnodiging accepteren</button>
          <button onClick={() => supabase.auth.signOut()}>Ander account</button></div>
      </div>
    </div>
  );
}
