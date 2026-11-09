import { useEffect, useState } from 'react';
import { supabase, errText } from '../../lib/supabase';
import { Field, Msg } from '../../components/ui';
import type { TabProps } from './types';

/** Kerngegevens bewerken met revisiecontrole: geen stil overschrijven van andermans wijziging. */
export default function Overzicht({ project, canEdit, people, reloadProject }: TabProps) {
  const initial = () => ({
    name: project.name, manager: project.manager_person_id ?? '', briefing: project.briefing ?? '',
    agreements: project.agreements ?? '', year: String(project.year),
  });
  const [f, setF] = useState(initial);
  const [base, setBase] = useState(project.revision);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok' | 'warn'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => { if (!conflict) { setF(initial()); setBase(project.revision); } }, [project.revision]); // eslint-disable-line

  async function save(revision: number) {
    setMsg(null);
    const { data, error } = await supabase.from('project').update({
      name: f.name, manager_person_id: f.manager || null, briefing: f.briefing || null,
      agreements: f.agreements || null, year: Number(f.year),
    }).eq('id', project.id).eq('revision', revision).select('revision');
    if (error) return setMsg({ kind: 'error', text: errText(error) });
    if (!data?.length) {
      setConflict(true);
      return setMsg({ kind: 'warn', text: 'Iemand anders heeft dit project intussen gewijzigd. Je wijzigingen zijn niet opgeslagen en staan nog in het formulier.' });
    }
    setConflict(false);
    setMsg({ kind: 'ok', text: 'Opgeslagen.' });
    await reloadProject();
  }

  async function forceSave() {
    const { data } = await supabase.from('project').select('revision').eq('id', project.id).single();
    if (data) await save(data.revision);
  }

  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          <Field id="pn" label="Projectnaam"><input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field id="pm" label="Projectverantwoordelijke">
            <select id="pm" value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })}>
              <option value="">Nog niet gekozen</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field id="py" label="Registerjaar"><input id="py" type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
        </div>
        <Field id="pb" label="Briefing"><textarea id="pb" rows={6} value={f.briefing} onChange={(e) => setF({ ...f, briefing: e.target.value })} /></Field>
        <Field id="pa" label="Afspraken" hint="Bijv. aantal feedbackrondes, opleverformaten, relevante links. Budgetten staan in Bruto.">
          <textarea id="pa" rows={5} value={f.agreements} onChange={(e) => setF({ ...f, agreements: e.target.value })} />
        </Field>
      </fieldset>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {canEdit && (
        <div className="row">
          {!conflict && <button className="primary" onClick={() => save(base)}>Opslaan</button>}
          {conflict && <>
            <button onClick={async () => { setConflict(false); setMsg(null); await reloadProject(); }}>Nieuwste versie laden (mijn wijzigingen vervallen)</button>
            <button className="primary" onClick={forceSave}>Mijn versie toch opslaan</button>
          </>}
        </div>
      )}
    </div>
  );
}
