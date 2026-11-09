import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, errText, must } from '../lib/supabase';
import { canCreateProjects, isManager, useCtx } from '../lib/session';
import { useLoad } from '../lib/useLoad';
import { bedrijfLabel, datum, numberStatusLabel } from '../lib/labels';
import { Field, Loading, Msg, Pill, downloadCsv } from '../components/ui';

type Num = {
  id: string; number_display: string; company: string | null; year: number | null; seq: number | null; status: string;
  status_reason: string | null; name: string | null; note: string | null; source: string; nonstandard: boolean; kind: string;
  project_id: string | null; asana_url: string | null; archive_link: string | null; created_at: string; revision: number;
  client_org: { id: string; name: string } | null; project: { name: string; archived: boolean } | null;
};
type Overview = { next_seq: number; next_code: string; free_seqs: number[]; used: number; highest: number };

const statusTone = (s: string) => (s === 'project' ? 'ok' : ['verloren', 'geannuleerd', 'vervallen'].includes(s) ? undefined : 'info');
const thisYear = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 4));

export default function Register() {
  const ctx = useCtx();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [company, setCompany] = useState('studio_brutaal');
  const [year, setYear] = useState(params.get('jaar') || String(thisYear));
  const [status, setStatus] = useState('');
  const [client, setClient] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const mayIssue = canCreateProjects(ctx.role);

  const { data, error, loading, reload } = useLoad(async () => {
    const [nums, ovSb, ovMms, clients] = await Promise.all([
      supabase.from('project_number').select('*, client_org(id,name), project(name,archived)').eq('kind', 'primair')
        .order('year', { ascending: false }).order('seq', { ascending: false, nullsFirst: false }).order('number_display', { ascending: false }),
      supabase.rpc('register_year_overview', { p_ws: ctx.workspace_id, p_company: 'studio_brutaal', p_year: Number(year) || thisYear }),
      supabase.rpc('register_year_overview', { p_ws: ctx.workspace_id, p_company: 'moviemates', p_year: Number(year) || thisYear }),
      supabase.from('client_org').select('id,name').order('name'),
    ]);
    return {
      nums: must(nums) as Num[], ov: { studio_brutaal: (must(ovSb) as Overview[])[0], moviemates: (must(ovMms) as Overview[])[0] },
      clients: must(clients) as { id: string; name: string }[],
    };
  }, [ctx.workspace_id, year]);

  const years = useMemo(() => [...new Set([thisYear, ...(data?.nums ?? []).map((n) => n.year).filter(Boolean) as number[]])].sort((a, b) => b - a), [data]);
  const rows = (data?.nums ?? []).filter((n) => {
    if (year && String(n.year) !== year) return false;
    if (status && n.status !== status) return false;
    if (client && n.client_org?.id !== client) return false;
    const hay = `${n.number_display} ${n.name ?? ''} ${n.project?.name ?? ''} ${n.client_org?.name ?? ''}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase()) || hay.replace(/\s/g, '').includes(q.toLowerCase().replace(/\s/g, ''));
  });

  async function changeStatus(n: Num, s: string) {
    let reason: string | null = null;
    if (s === 'vervallen') { reason = prompt('Waarom vervalt dit nummer? (verplicht, bijv. "fout aangemaakt")'); if (!reason?.trim()) return; }
    const { error } = await supabase.rpc('set_number_status', { p_number: n.id, p_status: s, p_reason: reason });
    setMsg(error ? { kind: 'error', text: errText(error) } : { kind: 'ok', text: `${n.number_display}: ${numberStatusLabel[s]}. Het nummer blijft in het register.` });
    await reload();
  }

  async function exportCsv() {
    const { data: rows2, error } = await supabase.rpc('export_data', { p_ws: ctx.workspace_id });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    downloadCsv(`register-${year || 'alle-jaren'}.csv`, (rows2.nummerregister as Record<string, unknown>[])
      .filter((r) => !year || String(r.year) === year)
      .map((r) => ({ code: r.number_display, bedrijf: r.company, jaar: r.year, volgnummer: r.seq, status: r.status, naam: r.name,
        klant: data?.clients.find((c) => c.id === r.client_org_id)?.name ?? '', bron: r.source, afwijkend_formaat: r.nonstandard,
        project_id: r.project_id, asana: r.asana_url, archief: r.archive_link, notitie: r.note, reden: r.status_reason })));
  }

  return (
    <>
      <div className="row between">
        <h1>Nummerregister</h1>
        <div className="row">
          {isManager(ctx.role) && <button onClick={exportCsv}>Exporteer CSV</button>}
        </div>
      </div>
      <p className="muted small">Nummers worden nooit hergebruikt of verwijderd. Verloren, geannuleerde en vervallen nummers blijven zichtbaar. Tot de Bruto-koppeling actief is, geeft Regie de nummers uit; neem het nummer in Bruto over met "Eigen nummer".</p>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Msg>{error}</Msg>

      {data && (
        <div className="grid2" style={{ marginBottom: 16 }}>
          {(['studio_brutaal', 'moviemates'] as const).map((c) => (
            <div key={c} className="card" style={{ margin: 0 }}>
              <h2>{bedrijfLabel[c]} · {year || thisYear}</h2>
              <div className="kv">
                <span className="muted">Volgende nummer</span><strong>{data.ov[c]?.next_code ?? '—'}</strong>
                <span className="muted">Uitgegeven</span><span>{data.ov[c]?.used ?? 0}</span>
                <span className="muted">Vrije nummers</span>
                <span>{data.ov[c]?.free_seqs.length ? data.ov[c].free_seqs.slice(0, 30).join(', ') + (data.ov[c].free_seqs.length > 30 ? '…' : '') : 'geen'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {mayIssue && data && <IssueForm clients={data.clients} defaultYear={Number(year) || thisYear} company={company} setCompany={setCompany}
        onDone={async (text, kind = 'ok') => { setMsg({ kind, text }); await reload(); }} />}

      <div className="row" style={{ margin: '16px 0' }}>
        <input aria-label="Zoeken in register" placeholder="Zoek op code, naam of klant" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <select aria-label="Jaar" value={year} onChange={(e) => setYear(e.target.value)} style={{ maxWidth: 140 }}>
          <option value="">Alle jaren</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">Alle statussen</option>
          {Object.entries(numberStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Klant" value={client} onChange={(e) => setClient(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Alle klanten</option>
          {data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading && !data ? <Loading /> : rows.length === 0 ? <div className="card muted">Geen nummers voor deze filters.</div> : (
        <table className="list">
          <thead><tr><th>Code</th><th>Naam en klant</th><th>Status</th><th>Bron</th><th></th></tr></thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td data-label="Code"><strong>{n.number_display}</strong>{n.nonstandard && <div><Pill tone="warn">Afwijkend formaat</Pill></div>}</td>
                <td data-label="Naam">
                  {n.project_id ? <Link to={`/projecten/${n.project_id}`}>{n.project?.name ?? n.name}</Link> : (n.name ?? <span className="muted">—</span>)}
                  <div className="small muted">{n.client_org?.name ?? 'Geen klant'}{n.year ? ` · ${n.year}` : ''}{n.project?.archived ? ' · gearchiveerd' : ''}</div>
                  {n.note && <div className="small">{n.note}</div>}
                  {(n.archive_link || n.asana_url) && <div className="small">{n.archive_link && <a href={n.archive_link} target="_blank" rel="noreferrer">Archief</a>}{n.archive_link && n.asana_url && ' · '}{n.asana_url && <a href={n.asana_url} target="_blank" rel="noreferrer">Asana</a>}</div>}
                </td>
                <td data-label="Status">
                  <Pill tone={statusTone(n.status)}>{numberStatusLabel[n.status]}</Pill>
                  {n.status_reason && <div className="small muted">{n.status_reason}</div>}
                </td>
                <td data-label="Bron" className="small">{n.source}<div className="muted">{datum(n.created_at)}</div></td>
                <td>
                  {n.status !== 'project' && mayIssue && (
                    <div className="row">
                      {!['verloren', 'geannuleerd', 'vervallen'].includes(n.status) && (
                        <button onClick={() => nav(`/projecten/nieuw?nummer=${n.id}`)}>Project starten</button>
                      )}
                      <select aria-label={`Status ${n.number_display}`} value="" onChange={(e) => e.target.value && changeStatus(n, e.target.value)} style={{ maxWidth: 170 }}>
                        <option value="">Status wijzigen…</option>
                        {['gereserveerd', 'pitch', 'offerte', 'losse_klus', ...(isManager(ctx.role) ? ['verloren', 'geannuleerd', 'vervallen'] : [])]
                          .filter((s) => s !== n.status).map((s) => <option key={s} value={s}>{numberStatusLabel[s]}</option>)}
                      </select>
                    </div>
                  )}
                  <NumberInfo n={n} clients={data?.clients ?? []} mayEdit={mayIssue} reload={reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isManager(ctx.role) && <Import onDone={reload} />}
    </>
  );
}

function IssueForm({ clients, defaultYear, company, setCompany, onDone }: {
  clients: { id: string; name: string }[]; defaultYear: number; company: string; setCompany: (c: string) => void;
  onDone: (text: string, kind?: 'ok' | 'warn') => Promise<void>;
}) {
  const ctx = useCtx();
  const [f, setF] = useState({ year: String(defaultYear), status: 'offerte', name: '', client: '', clientName: '', note: '', mode: 'volgend', seq: '', code: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID()); // idempotent: dubbel klikken geeft hetzelfde nummer
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('issue_number', {
      p_ws: ctx.workspace_id, p_company: company, p_year: Number(f.year), p_status: f.status, p_name: f.name || null,
      p_client_org_id: f.client && f.client !== 'nieuw' ? f.client : null, p_client_name: f.client === 'nieuw' ? f.clientName : null,
      p_note: f.note || null, p_seq: f.mode === 'vrij' && f.seq ? Number(f.seq) : null, p_code: f.mode === 'eigen' ? f.code : null, p_op: op,
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOp(crypto.randomUUID());
    setF({ ...f, name: '', note: '', seq: '', code: '' });
    const warn = data.gap ? ' Let op: er ontstaat een gat in de reeks (zie vrije nummers).' : data.nonstandard ? ' Let op: dit nummer wijkt af van het standaardformaat.' : '';
    await onDone(`Nummer ${data.code} uitgegeven.${warn}`, warn ? 'warn' : 'ok');
  }
  return (
    <details className="card">
      <summary>Nieuw nummer uitgeven (pitch, offerte of losse klus)</summary>
      <form onSubmit={submit} style={{ marginTop: 12 }}>
        <div className="grid2">
          <Field id="ic" label="Bedrijf">
            <select id="ic" value={company} onChange={(e) => setCompany(e.target.value)}>
              {Object.entries(bedrijfLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field id="iy" label="Jaar van uitgifte"><input id="iy" type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
          <Field id="is" label="Status">
            <select id="is" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {['gereserveerd', 'pitch', 'offerte', 'losse_klus'].map((s) => <option key={s} value={s}>{numberStatusLabel[s]}</option>)}
            </select>
          </Field>
          <Field id="in" label="Naam (werktitel)"><input id="in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field id="icl" label="Klant">
            <select id="icl" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
              <option value="">Nog onbekend</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="nieuw">+ Nieuwe klant…</option>
            </select>
          </Field>
          {f.client === 'nieuw' && <Field id="icn" label="Naam nieuwe klant"><input id="icn" required value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} /></Field>}
          <Field id="im" label="Nummer">
            <select id="im" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
              <option value="volgend">Volgende nummer (voorstel)</option>
              <option value="vrij">Vrij nummer kiezen (volgnummer)</option>
              <option value="eigen">Eigen code invoeren</option>
            </select>
          </Field>
          {f.mode === 'vrij' && <Field id="iq" label="Volgnummer"><input id="iq" type="number" min={1} required value={f.seq} onChange={(e) => setF({ ...f, seq: e.target.value })} /></Field>}
          {f.mode === 'eigen' && <Field id="ico" label="Code" hint="Bestaande nummers worden geweigerd."><input id="ico" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="bijv. SB26130" /></Field>}
        </div>
        <Field id="ino" label="Notitie"><input id="ino" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Msg>{err}</Msg>
        <button className="primary" disabled={busy}>Nummer uitgeven</button>
      </form>
    </details>
  );
}

function NumberInfo({ n, clients, mayEdit, reload }: { n: Num; clients: { id: string; name: string }[]; mayEdit: boolean; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: n.name ?? '', client: n.client_org?.id ?? '', note: n.note ?? '', archive: n.archive_link ?? '', asana: n.asana_url ?? '' });
  const [err, setErr] = useState('');
  if (!mayEdit) return null;
  if (!open) return <button className="link small" onClick={() => setOpen(true)}>Gegevens bewerken</button>;
  async function save(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc('update_number_info', {
      p_number: n.id, p_name: f.name, p_client_org_id: f.client || null, p_note: f.note || null,
      p_archive_link: f.archive, p_asana_url: f.asana, p_revision: n.revision,
    });
    if (error) return setErr(errText(error));
    if (data == null) return setErr('Iemand anders heeft dit nummer intussen gewijzigd. Je invoer staat nog hier; laad opnieuw en probeer het nog eens.');
    setOpen(false);
    await reload();
  }
  return (
    <form onSubmit={save} className="stack" style={{ marginTop: 8, minWidth: 240 }}>
      <input aria-label="Naam" placeholder="Naam" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select aria-label="Klant" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
        <option value="">Geen klant</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input aria-label="Notitie" placeholder="Notitie" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <input aria-label="Archieflink" placeholder="Link naar Asana-export (archief)" value={f.archive} onChange={(e) => setF({ ...f, archive: e.target.value })} />
      <input aria-label="Asana-link" placeholder="Asana-link" value={f.asana} onChange={(e) => setF({ ...f, asana: e.target.value })} />
      <Msg>{err}</Msg>
      <div className="row"><button>Opslaan</button><button type="button" onClick={() => setOpen(false)}>Annuleren</button></div>
    </form>
  );
}

type ImportRow = { line: number; code: string | null; company: string | null; year: number | null; status: string | null; name: string | null; client: string | null; issues: string[]; action: string };

/** Import uit Asana (CSV): eerst een voorbeeld met afwijkingen, pas na akkoord importeren. */
function Import({ onDone }: { onDone: () => Promise<void> }) {
  const ctx = useCtx();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function parse(): Record<string, string>[] {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];
    const sep = lines[0].includes(';') ? ';' : ',';
    const split = (l: string) => {
      const out: string[] = []; let cur = ''; let quoted = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') { if (quoted && l[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
        else if (ch === sep && !quoted) { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out.map((x) => x.trim());
    };
    const head = split(lines[0]).map((h) => h.toLowerCase());
    const col = (names: string[]) => head.findIndex((h) => names.includes(h));
    const idx = { code: col(['code', 'nummer', 'projectnummer']), name: col(['naam', 'name', 'projectnaam']), client: col(['klant', 'client']),
      year: col(['jaar', 'year']), status: col(['status']), asana: col(['asana', 'asana_url', 'link']), company: col(['bedrijf', 'company']) };
    return lines.slice(1).map((l) => {
      const c = split(l);
      const g = (i: number) => (i >= 0 ? c[i] ?? '' : '');
      return { code: g(idx.code), name: g(idx.name), client: g(idx.client), year: g(idx.year), status: g(idx.status).toLowerCase(), asana_url: g(idx.asana), company: g(idx.company) };
    });
  }
  async function run(commit: boolean) {
    setMsg(null);
    const rows = parse();
    if (!rows.length) return setMsg({ kind: 'error', text: 'Geen regels gevonden. De eerste regel moet kolomnamen bevatten (bijv. code;naam;klant;jaar;status;asana).' });
    const { data, error } = await supabase.rpc('import_numbers', { p_ws: ctx.workspace_id, p_rows: rows, p_commit: commit });
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    setPreview(data as ImportRow[]);
    if (commit) {
      setMsg({ kind: 'ok', text: `${(data as ImportRow[]).filter((r) => r.action === 'geïmporteerd').length} nummers geïmporteerd. Niets is hernummerd.` });
      await onDone();
    }
  }
  return (
    <details className="card" style={{ marginTop: 16 }}>
      <summary>Importeren uit Asana (CSV)</summary>
      <p className="small muted">Exporteer in Asana per project of via een lijst een CSV en plak de inhoud hieronder, of kies het bestand. Kolommen: code, naam, klant, jaar, status (pitch/offerte/losse_klus/verloren/geannuleerd), asana. Nummers worden ongewijzigd overgenomen; afwijkingen worden gemarkeerd.</p>
      <input type="file" accept=".csv,text/csv" aria-label="CSV-bestand" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <textarea aria-label="CSV-inhoud" rows={6} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder="code;naam;klant;jaar;status;asana" style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => run(false)}>Voorbeeld tonen</button>
        {preview && !preview.some((r) => r.action === 'geïmporteerd') && preview.some((r) => r.action === 'importeren') && (
          <button className="primary" onClick={() => { if (confirm(`${preview.filter((r) => r.action === 'importeren').length} nummers importeren?`)) void run(true); }}>Akkoord, importeren</button>
        )}
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {preview && (
        <table className="list" style={{ marginTop: 8 }}>
          <thead><tr><th>#</th><th>Code</th><th>Jaar</th><th>Naam / klant</th><th>Afwijkingen</th><th>Actie</th></tr></thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.line}>
                <td data-label="Regel">{r.line}</td>
                <td data-label="Code">{r.code}</td>
                <td data-label="Jaar">{r.year ?? '—'}</td>
                <td data-label="Naam">{r.name}<div className="small muted">{r.client}</div></td>
                <td data-label="Afwijkingen">{r.issues.length ? r.issues.map((i) => <Pill key={i} tone="warn">{i}</Pill>) : '—'}</td>
                <td data-label="Actie">{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
