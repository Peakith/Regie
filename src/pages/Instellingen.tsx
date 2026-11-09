import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, errText, must } from '../lib/supabase';
import { isManager, isOwnerOrAdmin, useCtx, useSession } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, datumTijd, roleLabel } from '../lib/labels';
import { Field, Loading, Msg, Pill, downloadCsv } from '../components/ui';

type Member = { user_id: string; email: string; role: string; person_name: string | null; revoked_at: string | null };
type Inv = { id: string; email: string; role: string; person_name: string | null; expires_at: string; created_at: string; accepted_at: string | null; revoked_at: string | null };
type Status = {
  integrations: { source: string; enabled: boolean }[]; events_failed: number; automations_failed: number; cron: boolean;
  events_recent: { id: string; source: string; type: string; event_id: string; status: string; attempts: number; error: string | null; received_at: string }[];
  automations_recent: { id: string; kind: string; status: string; summary: string | null; project_id: string | null; created_at: string }[];
  api_keys: { id: string; source: string; label: string; prefix: string; created_at: string; revoked_at: string | null; last_used_at: string | null }[];
};

const SECTIONS = ['Algemeen', 'Gebruikers', 'Beveiliging', 'Koppelingen', 'Prullenbak en export'] as const;

export default function Instellingen() {
  const ctx = useCtx();
  const [tab, setTab] = useState<(typeof SECTIONS)[number]>('Algemeen');
  const visible = SECTIONS.filter((s) => (s === 'Gebruikers' || s === 'Koppelingen' ? isOwnerOrAdmin(ctx.role) : true));
  return (
    <>
      <h1>Instellingen</h1>
      <div className="tabs" role="tablist">
        {visible.map((s) => <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)}>{s}</button>)}
      </div>
      {tab === 'Algemeen' && <Algemeen />}
      {tab === 'Gebruikers' && <Gebruikers />}
      {tab === 'Beveiliging' && <Beveiliging />}
      {tab === 'Koppelingen' && <Koppelingen />}
      {tab === 'Prullenbak en export' && <Prullenbak />}
    </>
  );
}

function Algemeen() {
  const ctx = useCtx();
  const admin = isOwnerOrAdmin(ctx.role);
  const { data, reload } = useLoad(async () => ({
    companies: must(await supabase.from('company_setting').select('*')) as { company: string; prefix: string; digits: number }[],
    org: (must(await supabase.from('org_setting').select('*')) as { stale_days: number; quiet_start: string; quiet_end: string }[])[0],
  }), []);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  async function saveCompany(company: string, prefix: string, digits: number) {
    const { error } = await supabase.from('company_setting').update({ prefix: prefix.toUpperCase(), digits }).eq('company', company).eq('organization_id', ctx.organization_id);
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Opgeslagen. Bestaande nummers veranderen niet.' });
    await reload();
  }
  async function saveOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from('org_setting').update({ stale_days: Number(fd.get('stale')), quiet_start: fd.get('qs'), quiet_end: fd.get('qe') }).eq('organization_id', ctx.organization_id);
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Opgeslagen.' });
    await reload();
  }
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <div className="card">
        <div className="kv">
          <span className="muted">Werkruimte</span><span>{ctx.workspace_name}</span>
          <span className="muted">Jouw rol</span><span>{roleLabel[ctx.role]}</span>
          <span className="muted">Opleverniveau</span><span><Pill tone="warn">Pilot-kandidaat, lokaal</Pill> Nog niet online; zie docs/testverslag.md</span>
        </div>
      </div>
      <div className="card">
        <h2>Op het beginscherm zetten</h2>
        <p className="small"><strong>iPhone (Safari):</strong> tik op de deelknop (vierkant met pijl) → "Zet op beginscherm" → "Voeg toe". Pushmeldingen werken op de iPhone alleen vanaf het beginscherm (iOS 16.4+), en pas zodra Regie online staat.</p>
        <p className="small"><strong>Android (Chrome):</strong> menu ⋮ → "App installeren" of "Toevoegen aan startscherm".</p>
        <p className="small"><strong>Mac (Chrome/Edge):</strong> installatie-icoon rechts in de adresbalk. In Safari: Archief → "Voeg toe aan Dock".</p>
        <p className="small">Zonder verbinding kun je de draaidagen van de komende 7 dagen en je eigen taken lezen via <Link to="/offline">Offline weergave</Link>.</p>
      </div>
      {data && (
        <div className="card">
          <h2>Bedrijven en nummerformaat</h2>
          {data.companies.map((c) => <CompanyRow key={c.company} c={c} admin={admin} onSave={saveCompany} />)}
          <h2 style={{ marginTop: 16 }}>Drempels en meldingen</h2>
          <form onSubmit={saveOrg}>
            <fieldset disabled={!admin} style={{ border: 0, padding: 0 }}>
              <div className="grid2">
                <Field id="stale" label='Drempel "Blijft hangen" (dagen)'><input id="stale" name="stale" type="number" min={1} defaultValue={data.org?.stale_days} /></Field>
                <Field id="qs" label="Stille uren vanaf"><input id="qs" name="qs" type="time" defaultValue={data.org?.quiet_start.slice(0, 5)} /></Field>
                <Field id="qe" label="Stille uren tot"><input id="qe" name="qe" type="time" defaultValue={data.org?.quiet_end.slice(0, 5)} /></Field>
              </div>
              {admin && <button>Opslaan</button>}
            </fieldset>
          </form>
        </div>
      )}
    </>
  );
}

function CompanyRow({ c, admin, onSave }: { c: { company: string; prefix: string; digits: number }; admin: boolean; onSave: (company: string, p: string, d: number) => void }) {
  const [p, setP] = useState(c.prefix);
  const [d, setD] = useState(c.digits);
  return (
    <div className="row" style={{ marginBottom: 6 }}>
      <span style={{ minWidth: 180 }}>{bedrijfLabel[c.company]}</span>
      <input aria-label="Prefix" value={p} disabled={!admin} onChange={(e) => setP(e.target.value)} style={{ maxWidth: 100 }} />
      <input aria-label="Cijfers volgnummer" type="number" min={2} max={6} value={d} disabled={!admin} onChange={(e) => setD(Number(e.target.value))} style={{ maxWidth: 80 }} />
      <span className="small muted">bijv. {p}{new Date().getFullYear() % 100}{'1'.padStart(d, '0')}</span>
      {admin && (p !== c.prefix || d !== c.digits) && <button onClick={() => onSave(c.company, p, d)}>Opslaan</button>}
    </div>
  );
}

function Gebruikers() {
  const ctx = useCtx();
  const { data, error, loading, reload } = useLoad(async () => ({
    members: must(await supabase.rpc('list_members', { p_ws: ctx.workspace_id })) as Member[],
    invites: must(await supabase.rpc('list_invitations', { p_ws: ctx.workspace_id })) as Inv[],
    orphans: must(await supabase.rpc('tasks_of_deactivated', { p_ws: ctx.workspace_id })) as { task_id: string; title: string; project_id: string | null; person_name: string; deadline: string | null }[],
    people: must(await supabase.from('person').select('id,full_name').is('user_id', null).order('full_name')) as { id: string; full_name: string }[],
  }), [ctx.workspace_id]);
  const [f, setF] = useState({ email: '', role: 'stagiair', person: '' });
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const roles = ['stagiair', 'medewerker', 'projectmanager', 'freelancer', ...(ctx.role === 'eigenaar' ? ['admin'] : [])];

  async function invite(e: FormEvent) {
    e.preventDefault();
    const { data: token, error } = await supabase.rpc('create_invitation', { p_ws: ctx.workspace_id, p_email: f.email, p_role: f.role, p_person_id: f.person || null });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    setLink(`${window.location.origin}/uitnodiging?token=${token}`);
    setMsg({ kind: 'ok', text: `Uitnodiging voor ${f.email} aangemaakt (${roleLabel[f.role]}). Stuur de link hieronder zelf door; hij werkt één keer en verloopt na 7 dagen.` });
    setF({ email: '', role: 'stagiair', person: '' });
    await reload();
  }
  async function revoke(m: Member) {
    if (!confirm(`Toegang van ${m.email} intrekken? Dit werkt direct, ook bij een open sessie. Toegewezen taken en historie blijven bestaan.`)) return;
    const { error } = await supabase.rpc('revoke_member', { p_ws: ctx.workspace_id, p_user: m.user_id });
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Toegang ingetrokken.' });
    await reload();
  }
  async function setRole(m: Member, role: string) {
    const { error } = await supabase.rpc('set_member_role', { p_ws: ctx.workspace_id, p_user: m.user_id, p_role: role });
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: `Rol gewijzigd naar ${roleLabel[role]}.` });
    await reload();
  }
  if (loading && !data) return <Loading />;
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {link && (
        <div className="card">
          <h3>Uitnodigingslink (wordt maar één keer getoond)</h3>
          <input readOnly value={link} aria-label="Uitnodigingslink" onFocus={(e) => e.target.select()} />
          <div className="row" style={{ marginTop: 8 }}><button onClick={() => navigator.clipboard?.writeText(link)}>Kopiëren</button><button onClick={() => setLink('')}>Sluiten</button></div>
          <p className="hint">Automatisch mailen volgt zodra Regie online staat met een afzenderdomein.</p>
        </div>
      )}
      <Msg>{error}</Msg>
      <form className="card" onSubmit={invite}>
        <h2>Uitnodigen</h2>
        <div className="grid2">
          <Field id="ie" label="E-mailadres"><input id="ie" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field id="ir" label="Rol" hint="Freelancer: ziet alleen eigen draaidagen en wat met crew gedeeld is.">
            <select id="ir" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
          </Field>
          <Field id="ip" label="Koppelen aan bestaande persoon (optioneel)">
            <select id="ip" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}>
              <option value="">Nieuwe persoon</option>{data?.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
        </div>
        <button className="primary">Uitnodiging maken</button>
      </form>

      <h2>Gebruikers</h2>
      <table className="list">
        <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          {data?.members.map((m) => (
            <tr key={m.user_id}>
              <td data-label="Naam">{m.person_name ?? '—'}</td>
              <td data-label="E-mail">{m.email}</td>
              <td data-label="Rol">
                {!m.revoked_at && m.role !== 'eigenaar' ? (
                  <select aria-label={`Rol ${m.email}`} value={m.role} onChange={(e) => setRole(m, e.target.value)} style={{ maxWidth: 170 }}>
                    {[...new Set([...roles, m.role])].map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                ) : roleLabel[m.role]}
                {m.revoked_at && <> <Pill tone="danger">Gedeactiveerd {datumTijd(m.revoked_at)}</Pill></>}
              </td>
              <td>{!m.revoked_at && m.role !== 'eigenaar' && <button className="danger" onClick={() => revoke(m)}>Toegang intrekken</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data && data.invites.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>Uitnodigingen</h2>
          <ul className="plain card">
            {data.invites.map((i) => (
              <li key={i.id} className="row between">
                <span>{i.email} · {roleLabel[i.role]}{i.person_name ? ` · ${i.person_name}` : ''}</span>
                <span className="small">
                  {i.accepted_at ? <Pill tone="ok">Geaccepteerd</Pill> : i.revoked_at ? <Pill>Ingetrokken</Pill> : new Date(i.expires_at) < new Date() ? <Pill>Verlopen</Pill> : (
                    <>Geldig tot {datumTijd(i.expires_at)} <button className="link" onClick={async () => { await supabase.rpc('revoke_invitation', { p_invitation: i.id }); await reload(); }}>intrekken</button></>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.orphans.length > 0 && (
        <div className="card">
          <h2>Toegewezen aan gedeactiveerde gebruiker</h2>
          <ul className="plain">{data.orphans.map((o) => <li key={o.task_id}>{o.project_id ? <Link to={`/projecten/${o.project_id}?tab=Taken`}>{o.title}</Link> : o.title} <span className="small muted">· {o.person_name}</span></li>)}</ul>
        </div>
      )}
    </>
  );
}

function Beveiliging() {
  const ctx = useCtx();
  const { session } = useSession();
  const { data, reload } = useLoad(async () => {
    const { data: f, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return f.totp;
  }, []);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const verified = (data ?? []).filter((f) => f.status === 'verified');

  async function start() {
    const { data: d, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Regie ${new Date().toISOString().slice(0, 10)}` });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    setEnroll({ id: d.id, qr: d.totp.qr_code, secret: d.totp.secret });
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll!.id, code });
    if (error) return setMsg({ kind: 'error', text: 'Code klopt niet. Controleer de tijd op je telefoon en probeer opnieuw.' });
    setEnroll(null); setCode('');
    setMsg({ kind: 'ok', text: 'Tweestapsverificatie staat aan. Bij inloggen vraagt Regie voortaan om een code.' });
    await reload();
  }
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <div className="card">
        <h2>Tweestapsverificatie</h2>
        <p className="small">Ingelogd als {session?.user.email}. Met een tweede factor (een code uit een authenticator-app zoals de Wachtwoorden-app van Apple, 1Password of Google Authenticator) is een gestolen wachtwoord niet genoeg om in te loggen. De database weigert gegevens aan sessies zonder die code.</p>
        {ctx.role === 'eigenaar' && verified.length === 0 && <Msg kind="warn">Als eigenaar is tweestapsverificatie verplicht. Stel het nu in.</Msg>}
        {verified.length > 0 ? <p><Pill tone="ok">Aan</Pill> {verified.length} authenticator(s) ingesteld.</p> : !enroll && <button className="primary" onClick={start}>Instellen</button>}
        {enroll && (
          <form onSubmit={verify} className="stack">
            <p className="small">Scan deze QR-code met je authenticator-app, of voer de sleutel handmatig in.</p>
            <img src={enroll.qr} alt="QR-code voor authenticator-app" style={{ width: 200, height: 200, background: '#fff', padding: 8, borderRadius: 8 }} />
            <code style={{ wordBreak: 'break-all' }}>{enroll.secret}</code>
            <Field id="mc" label="Code uit de app"><input id="mc" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 160 }} /></Field>
            <button className="primary">Bevestigen</button>
          </form>
        )}
        <p className="hint">Passkeys: de gebruikte inlogdienst ondersteunt die lokaal nog niet als tweede factor (zie docs/beslissingen.md).</p>
      </div>
    </>
  );
}

function Koppelingen() {
  const ctx = useCtx();
  const { data, error, loading, reload } = useLoad(async () => must(await supabase.rpc('system_status', { p_ws: ctx.workspace_id })) as Status, [ctx.workspace_id]);
  const [newKey, setNewKey] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [k, setK] = useState({ source: 'bruto', label: '' });
  if (loading && !data) return <Loading />;
  const names: Record<string, string> = { bruto: 'Bruto', reviewtool: 'Reviewtool', dropbox: 'Dropbox', moneybird: 'Moneybird', overig: 'Andere eigen tools' };
  const built = ['bruto', 'reviewtool', 'overig'];
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Msg>{error}</Msg>
      <div className="card">
        <h2>Status</h2>
        <div className="kv">
          <span className="muted">Mislukte berichten</span><span>{data?.events_failed ? <Pill tone="danger">{data.events_failed}</Pill> : 0}</span>
          <span className="muted">Mislukte automatiseringen</span><span>{data?.automations_failed ?? 0}</span>
          <span className="muted">Periodieke taak</span><span>{data?.cron ? 'actief (elke 5 minuten)' : 'niet beschikbaar: bijwerken bij laden van het dashboard'}</span>
          <span className="muted">Laatste back-up</span><span><Pill tone="warn">Niet ingericht</Pill> lokaal geen automatische back-ups; zie docs/beheer.md</span>
          <span className="muted">Laatste export</span><span>— (handmatig via Prullenbak en export)</span>
        </div>
      </div>
      <div className="card">
        <h2>Koppelingen</h2>
        <p className="small muted">Elke koppeling is los uit te zetten. Zonder koppeling werkt Regie gewoon.</p>
        {data?.integrations.map((i) => (
          <div key={i.source} className="row" style={{ marginBottom: 6 }}>
            <span style={{ minWidth: 170 }}>{names[i.source]}</span>
            {built.includes(i.source) ? (
              <label className="inline"><input type="checkbox" disabled={ctx.role !== 'eigenaar' && ctx.role !== 'admin'} checked={i.enabled}
                onChange={async (e) => { const { error } = await supabase.rpc('set_integration_enabled', { p_ws: ctx.workspace_id, p_source: i.source, p_enabled: e.target.checked }); setMsg(error ? { kind: 'error', text: errText(error) } : null); await reload(); }} />
                {i.enabled ? 'Aan' : 'Uit'}</label>
            ) : <Pill>Koppeling niet actief (nog niet gebouwd)</Pill>}
          </div>
        ))}
        <p className="hint">Aansluitpunt: <code>POST /rest/v1/rpc/api_events</code> en <code>/rest/v1/rpc/api_reserve_number</code> met header <code>x-regie-key</code>. Zie docs/integraties.md.</p>
      </div>
      <div className="card">
        <h2>API-sleutels</h2>
        {newKey && <Msg kind="ok">Nieuwe sleutel (wordt maar één keer getoond; bewaar hem in Bruto of de tool zelf, niet in een chat): <code style={{ wordBreak: 'break-all' }}>{newKey}</code></Msg>}
        <ul className="plain">
          {data?.api_keys.map((a) => (
            <li key={a.id} className="row between">
              <span>{a.label} · {names[a.source]} · <code>{a.prefix}…</code></span>
              <span className="small">{a.revoked_at ? <Pill>Ingetrokken</Pill> : <>laatst gebruikt {a.last_used_at ? datumTijd(a.last_used_at) : 'nooit'}{ctx.role === 'eigenaar' && <> · <button className="link" onClick={async () => { if (!confirm('Sleutel intrekken?')) return; await supabase.rpc('revoke_api_key', { p_key: a.id }); await reload(); }}>intrekken</button></>}</>}</span>
            </li>
          ))}
          {data?.api_keys.length === 0 && <li className="muted small">Nog geen sleutels.</li>}
        </ul>
        {ctx.role === 'eigenaar' && (
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            const { data: key, error } = await supabase.rpc('create_api_key', { p_ws: ctx.workspace_id, p_source: k.source, p_label: k.label });
            if (error) return setMsg({ kind: 'error', text: errText(error) });
            setNewKey(key as string); setK({ ...k, label: '' }); await reload();
          }}>
            <select aria-label="Bron" value={k.source} onChange={(e) => setK({ ...k, source: e.target.value })} style={{ maxWidth: 160 }}>
              <option value="bruto">Bruto</option><option value="reviewtool">Reviewtool</option><option value="overig">Andere tool</option>
            </select>
            <input aria-label="Omschrijving" required placeholder="bijv. Bruto op MacBook" value={k.label} onChange={(e) => setK({ ...k, label: e.target.value })} style={{ maxWidth: 260 }} />
            <button>Sleutel maken</button>
          </form>
        )}
      </div>
      <div className="card">
        <h2>Berichtenlog</h2>
        <table className="list">
          <tbody>
            {data?.events_recent.map((e) => (
              <tr key={e.id}>
                <td data-label="Ontvangen" className="small">{datumTijd(e.received_at)}</td>
                <td data-label="Bericht" className="small">{names[e.source] ?? e.source} · {e.type} · <code>{e.event_id}</code></td>
                <td data-label="Status" className="small"><Pill tone={e.status === 'verwerkt' ? 'ok' : e.status === 'fout' ? 'danger' : undefined}>{e.status}</Pill> {e.attempts > 1 && `${e.attempts} pogingen`}{e.error && <div>{e.error}</div>}
                  {e.status === 'fout' && <button className="link" onClick={async () => { const { error } = await supabase.rpc('retry_event', { p_event: e.id }); setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Opnieuw verwerkt.' }); await reload(); }}>opnieuw proberen</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.events_recent.length === 0 && <p className="small muted">Nog geen berichten ontvangen.</p>}
      </div>
    </>
  );
}

type Trash = { kind: string; id: string; project_id: string | null; title: string; deleted_at: string; deleted_by_name: string | null };

function Prullenbak() {
  const ctx = useCtx();
  const { data, reload } = useLoad(async () => must(await supabase.rpc('trash_items', { p_ws: ctx.workspace_id })) as Trash[], [ctx.workspace_id]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const kindLabel: Record<string, string> = { task: 'Taak', deliverable: 'Deliverable', shoot_day: 'Draaidag', equipment: 'Apparatuur', link: 'Link', list: 'Lijst' };
  async function exportAll(format: 'json' | 'csv') {
    const { data: d, error } = await supabase.rpc('export_data', { p_ws: ctx.workspace_id });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      a.download = `regie-export-${stamp}.json`; a.click();
    } else {
      Object.entries(d as Record<string, Record<string, unknown>[]>).forEach(([t, rows]) => rows.length && downloadCsv(`regie-${t}-${stamp}.csv`, rows));
    }
    setMsg({ kind: 'ok', text: 'Export gedownload. Bewaar hem op een plek die van jou is (bijv. je eigen cloudmap).' });
  }
  return (
    <>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <div className="card">
        <h2>Prullenbak (30 dagen)</h2>
        <ul className="plain">
          {(data ?? []).map((t) => (
            <li key={t.kind + t.id} className="row between">
              <span><Pill>{kindLabel[t.kind]}</Pill> {t.title} <span className="small muted">· {datumTijd(t.deleted_at)}{t.deleted_by_name ? ` · ${t.deleted_by_name}` : ''}</span></span>
              <button onClick={async () => { const { error } = await supabase.rpc('restore_item', { p_kind: t.kind, p_id: t.id }); setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: 'Hersteld.' }); await reload(); }}>Herstellen</button>
            </li>
          ))}
          {data?.length === 0 && <li className="muted small">De prullenbak is leeg (of je hebt geen rechten om te herstellen).</li>}
        </ul>
        <p className="hint">Definitief verwijderen is nog niet gebouwd; items blijven na 30 dagen in de database maar zijn niet meer te herstellen via de app.</p>
      </div>
      {isManager(ctx.role) && (
        <div className="card">
          <h2>Export</h2>
          <p className="small">Alle projecten, het register, klanten, personen, deliverables, versies, draaidagen, taken, besluiten en templates.</p>
          <div className="row"><button onClick={() => exportAll('json')}>Alles als JSON</button><button onClick={() => exportAll('csv')}>CSV per tabel</button></div>
        </div>
      )}
    </>
  );
}
