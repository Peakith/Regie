import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { datum, linkKindLabel } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type L = { id: string; kind: string; url: string; label: string | null; external_id: string | null; visibility: string;
  license_source: string | null; license_title: string | null; license_id: string | null; license_valid_until: string | null; created_at: string };

/** Bestanden en links: alleen verwijzingen en metadata. Videobestanden staan in Dropbox, niet in Regie. */
export default function Links({ project, canEdit }: TabProps) {
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from('external_link').select('*').eq('project_id', project.id).order('created_at')) as L[], [project.id]);
  const [f, setF] = useState({ kind: 'dropbox', url: '', label: '', crew: false, source: '', title: '', lid: '', until: '' });
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('external_link').insert({
      project_id: project.id, kind: f.kind, url: f.url.trim(), label: f.label || null, visibility: f.crew ? 'crew' : 'intern',
      license_source: f.kind === 'licentie' ? f.source || null : null, license_title: f.kind === 'licentie' ? f.title || null : null,
      license_id: f.kind === 'licentie' ? f.lid || null : null, license_valid_until: f.kind === 'licentie' && f.until ? f.until : null,
    });
    if (error) return setErr(errText(error).includes('check') ? 'Een link moet beginnen met http:// of https://.' : errText(error));
    setErr(''); setF({ ...f, url: '', label: '', source: '', title: '', lid: '', until: '' });
    await reload();
  }
  if (loading && !data) return <Loading />;
  return (
    <>
      <Msg kind="info">De Dropbox-koppeling is nog niet actief: links worden hier handmatig vastgelegd. Regie maakt nooit zelf gedeelde of openbare links.</Msg>
      <Msg>{error}</Msg>
      {data?.length === 0 && <div className="card muted">Nog geen links.</div>}
      {data?.map((l) => (
        <div key={l.id} className="item row between">
          <div>
            <Pill>{linkKindLabel[l.kind]}</Pill> <a href={l.url} target="_blank" rel="noreferrer">{l.label || l.url}</a>
            {l.visibility === 'crew' && <> <Pill tone="info">Gedeeld met crew</Pill></>}
            {l.kind === 'licentie' && (
              <div className="small">{[l.license_source, l.license_title, l.license_id && `licentie ${l.license_id}`, l.license_valid_until && `geldig tot ${datum(l.license_valid_until)}`].filter(Boolean).join(' · ')}</div>
            )}
          </div>
          {canEdit && <button className="link" onClick={async () => { const { error } = await supabase.rpc('soft_delete', { p_kind: 'link', p_id: l.id }); setErr(error ? errText(error) : ''); await reload(); }}>verwijderen</button>}
        </div>
      ))}
      {canEdit && (
        <form className="card" onSubmit={add}>
          <h2>Link toevoegen</h2>
          <div className="grid2">
            <Field id="lk" label="Soort">
              <select id="lk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {Object.entries(linkKindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field id="lu" label="URL"><input id="lu" type="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></Field>
            <Field id="ll" label="Label"><input id="ll" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
            {f.kind === 'licentie' && <>
              <Field id="lso" label="Bron (bijv. Artlist, Adobe Stock)"><input id="lso" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
              <Field id="lti" label="Titel"><input id="lti" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field id="lid" label="Licentie-ID"><input id="lid" value={f.lid} onChange={(e) => setF({ ...f, lid: e.target.value })} /></Field>
              <Field id="lgu" label="Geldig tot"><input id="lgu" type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
            </>}
          </div>
          <div className="field"><label className="inline"><input type="checkbox" checked={f.crew} onChange={(e) => setF({ ...f, crew: e.target.checked })} /> Zichtbaar voor ingeboekte crew</label></div>
          <Msg>{err}</Msg>
          <button className="primary">Toevoegen</button>
        </form>
      )}
    </>
  );
}
