import { useState, type FormEvent } from 'react';
import { supabase, errText, must } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { datumTijd } from '../lib/labels';
import { Msg, Pill } from './ui';

type C = { id: string; body: string; visibility: string; author: string; created_at: string };

/** Opmerkingen bij een onderdeel. Standaard intern; "gedeeld met crew" is zichtbaar voor ingeboekte freelancers. */
export default function Opmerkingen({ projectId, subjectType, subjectId, canEdit, allowCrew = false }: {
  projectId: string; subjectType: string; subjectId: string; canEdit: boolean; allowCrew?: boolean;
}) {
  const { data, reload } = useLoad(async () => must(await supabase.from('comment').select('id,body,visibility,author,created_at')
    .eq('project_id', projectId).eq('subject_type', subjectType).eq('subject_id', subjectId).order('created_at')) as C[], [subjectId]);
  const [body, setBody] = useState('');
  const [crew, setCrew] = useState(false);
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('comment').insert({ project_id: projectId, subject_type: subjectType, subject_id: subjectId, body, visibility: crew ? 'crew' : 'intern' });
    if (error) return setErr(errText(error));
    setBody(''); setCrew(false); setErr('');
    await reload();
  }
  return (
    <div className="stack">
      {(data ?? []).map((c) => (
        <div key={c.id} className="small">
          {c.visibility === 'crew' ? <Pill tone="info">Gedeeld met crew</Pill> : <Pill>Intern</Pill>} {c.body}
          <span className="muted"> · {datumTijd(c.created_at)}</span>
        </div>
      ))}
      {canEdit && (
        <form onSubmit={add} className="row">
          <input aria-label="Opmerking" placeholder="Opmerking toevoegen" required value={body} onChange={(e) => setBody(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          {allowCrew && <label className="inline"><input type="checkbox" checked={crew} onChange={(e) => setCrew(e.target.checked)} /> Delen met crew</label>}
          <button>Plaatsen</button>
        </form>
      )}
      <Msg>{err}</Msg>
    </div>
  );
}
