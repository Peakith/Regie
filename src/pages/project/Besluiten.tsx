import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { datum, datumTijd, decisionKindLabel, vandaag } from '../../lib/labels';
import { Field, Loading, Msg, Pill } from '../../components/ui';
import type { TabProps } from './types';

type D = { id: string; kind: string; subject: string; taken_by_name: string | null; decided_on: string; evidence: string | null;
  corrects_id: string | null; source: string; created_at: string; deliverable: { title: string } | null; deliverable_version: { version_no: number } | null };

/** Besluiten zijn onveranderlijk: een correctie is een nieuw besluit dat naar het oude verwijst. */
export default function Besluiten({ project, canApprove }: TabProps) {
  const { data, error, loading, reload } = useLoad(async () => ({
    list: must(await supabase.from('decision').select('*, deliverable(title), deliverable_version(version_no)').eq('project_id', project.id).order('created_at', { ascending: false })) as D[],
    delivs: must(await supabase.from('deliverable').select('id,title').eq('project_id', project.id).order('sort')) as { id: string; title: string }[],
  }), [project.id]);
  const [f, setF] = useState({ kind: 'afspraak', subject: '', by: '', date: vandaag(), evidence: '', deliverable: '', corrects: '' });
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('record_decision', {
      p_project: project.id, p_kind: f.kind, p_subject: f.subject, p_taken_by: f.by || null, p_decided_on: f.date,
      p_evidence: f.evidence || null, p_deliverable: f.deliverable || null, p_corrects: f.corrects || null,
    });
    if (error) return setErr(errText(error));
    setErr(''); setF({ ...f, subject: '', by: '', evidence: '', corrects: '' });
    await reload();
  }
  if (loading && !data) return <Loading />;
  const corrected = new Set((data?.list ?? []).map((d) => d.corrects_id).filter(Boolean));
  return (
    <>
      <Msg>{error}</Msg>
      {data?.list.length === 0 && <div className="card muted">Nog geen besluiten. Goedkeuringen van versies verschijnen hier automatisch.</div>}
      {data?.list.map((d) => (
        <div key={d.id} className="item">
          <div className="row between">
            <div><Pill tone={d.kind === 'goedkeuring_versie' ? 'ok' : d.kind === 'meerwerk' ? 'warn' : 'info'}>{decisionKindLabel[d.kind]}</Pill> <strong>{d.subject}</strong></div>
            <span className="small muted">{datum(d.decided_on)}</span>
          </div>
          <div className="small">
            {d.taken_by_name && <>Genomen door {d.taken_by_name} · </>}
            {d.deliverable && <>{d.deliverable.title}{d.deliverable_version ? ` v${d.deliverable_version.version_no}` : ''} · </>}
            {d.evidence && <>Bewijs: {/^https?:\/\//.test(d.evidence) ? <a href={d.evidence} target="_blank" rel="noreferrer">{d.evidence}</a> : d.evidence} · </>}
            <span className="muted">vastgelegd {datumTijd(d.created_at)}{d.source !== 'handmatig' ? ` (${d.source})` : ''}</span>
          </div>
          {d.corrects_id && <div className="small muted">Corrigeert een eerder besluit.</div>}
          {corrected.has(d.id) && <Pill>Gecorrigeerd door een later besluit</Pill>}
        </div>
      ))}
      {canApprove && (
        <form className="card" onSubmit={add}>
          <h2>Besluit vastleggen</h2>
          <div className="grid2">
            <Field id="bk" label="Soort">
              <select id="bk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {Object.entries(decisionKindLabel).filter(([k]) => k !== 'goedkeuring_versie').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field id="bs" label="Onderwerp"><input id="bs" required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
            <Field id="bb" label="Genomen door (klantcontact)"><input id="bb" value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} /></Field>
            <Field id="bd" label="Datum"><input id="bd" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field id="bdl" label="Deliverable (optioneel)">
              <select id="bdl" value={f.deliverable} onChange={(e) => setF({ ...f, deliverable: e.target.value })}>
                <option value="">Geen</option>{data?.delivs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </Field>
            <Field id="bc" label="Corrigeert besluit (optioneel)">
              <select id="bc" value={f.corrects} onChange={(e) => setF({ ...f, corrects: e.target.value })}>
                <option value="">Geen</option>{data?.list.map((d) => <option key={d.id} value={d.id}>{datum(d.decided_on)} · {d.subject}</option>)}
              </select>
            </Field>
          </div>
          <Field id="be" label="Bewijs" hint="Link naar de mail of reviewtool, of een notitie."><input id="be" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></Field>
          <Msg>{err}</Msg>
          <button className="primary">Vastleggen</button>
          <p className="hint">Een besluit kan daarna niet meer worden gewijzigd. Corrigeren gaat via een nieuw besluit.</p>
        </form>
      )}
    </>
  );
}
