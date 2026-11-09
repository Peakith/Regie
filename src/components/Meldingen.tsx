import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, must } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { datumTijd } from '../lib/labels';

type N = { id: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null; kind: string };

/** Meldingen in de app. Push op de telefoon vereist hosting met HTTPS en is nog niet actief. */
export default function Meldingen() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { data, reload } = useLoad(async () =>
    must(await supabase.from('notification').select('*').order('created_at', { ascending: false }).limit(40)) as N[], []);
  const unread = (data ?? []).filter((n) => !n.read_at);
  async function readAll() {
    await supabase.rpc('mark_notifications_read', { p_ids: null });
    await reload();
  }
  return (
    <>
      <button className="iconbtn" onClick={() => setOpen(true)} aria-label={`Meldingen, ${unread.length} ongelezen`}>
        Meldingen{unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Meldingen" onClick={() => setOpen(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><h2 style={{ margin: 0 }}>Meldingen</h2>
              <div className="row">{unread.length > 0 && <button onClick={readAll}>Alles gelezen</button>}<button onClick={() => setOpen(false)}>Sluiten</button></div>
            </div>
            <ul className="plain" style={{ marginTop: 8 }}>
              {(data ?? []).map((n) => (
                <li key={n.id} style={{ opacity: n.read_at ? 0.6 : 1 }}>
                  <a href={n.link ?? '#'} onClick={async (e) => {
                    e.preventDefault();
                    await supabase.rpc('mark_notifications_read', { p_ids: [n.id] });
                    setOpen(false); void reload();
                    if (n.link) nav(n.link);
                  }}>{n.title}</a>
                  {n.body && <div className="small" style={{ whiteSpace: 'pre-line' }}>{n.body}</div>}
                  <div className="small muted">{datumTijd(n.created_at)}</div>
                </li>
              ))}
              {data?.length === 0 && <li className="muted">Geen meldingen.</li>}
            </ul>
            <p className="hint">Meldingen verschijnen hier. Pushmeldingen op de telefoon zijn nog niet actief: daarvoor moet Regie eerst online staan.</p>
          </div>
        </div>
      )}
    </>
  );
}
