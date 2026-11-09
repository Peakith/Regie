import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useCtx } from '../lib/session';
import { Pill } from './ui';

type Hit = { kind: string; id: string; project_id: string | null; title: string; subtitle: string | null; year: number | null; archived: boolean };
const kindLabel: Record<string, string> = { nummer: 'Nummer', project: 'Project', klant: 'Klant', persoon: 'Persoon', deliverable: 'Deliverable', taak: 'Taak' };

/** Globale zoekfunctie (⌘K): nummers (ook verloren pitches en oude jaren), projecten, klanten, personen, deliverables, taken. */
export default function Zoeken({ onClose, onPick }: { onClose: () => void; onPick: (to: string) => void }) {
  const ctx = useCtx();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const t = window.setTimeout(async () => {
      if (q.trim().length < 2) { setHits([]); return; }
      const { data, error } = await supabase.rpc('search_all', { p_ws: ctx.workspace_id, p_q: q });
      setErr(error ? error.message : '');
      setHits((data as Hit[]) ?? []);
      setSel(0);
    }, 150);
    return () => window.clearTimeout(t);
  }, [q, ctx.workspace_id]);

  const target = (h: Hit) => {
    if (h.project_id) return `/projecten/${h.project_id}`;
    if (h.kind === 'nummer') return `/register?q=${encodeURIComponent(h.title.split(' |')[0])}&jaar=${h.year ?? ''}`;
    if (h.kind === 'klant' || h.kind === 'persoon') return '/personen';
    if (h.kind === 'taak') return '/mijn-taken';
    return '/dashboard';
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Zoeken" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <input ref={ref} aria-label="Zoekterm" placeholder="Zoek op nummer, project, klant, persoon…" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && hits[sel]) onPick(target(hits[sel]));
          }} />
        {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
        <ul className="plain" style={{ marginTop: 8 }}>
          {hits.map((h, i) => (
            <li key={h.kind + h.id} style={{ background: i === sel ? 'var(--surface-2)' : undefined, padding: 8, borderRadius: 6 }}>
              <a href={target(h)} onClick={(e) => { e.preventDefault(); onPick(target(h)); }}>
                <Pill>{kindLabel[h.kind]}</Pill> {h.title}
              </a>
              <div className="small muted">{[h.subtitle, h.year, h.archived ? 'gearchiveerd' : null].filter(Boolean).join(' · ')}</div>
            </li>
          ))}
          {q.trim().length >= 2 && hits.length === 0 && <li className="muted">Niets gevonden.</li>}
        </ul>
        <p className="hint">Tip: ⌘K (Mac) of Ctrl+K opent zoeken overal. Esc sluit.</p>
      </div>
    </div>
  );
}
