import type { ReactNode } from 'react';

export function Msg({ kind = 'error', children }: { kind?: 'error' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`msg ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Pill({ tone, children }: { tone?: 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Loading() {
  return <p className="muted" role="status">Laden…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card muted">{children}</div>;
}

/** Herkomst van een gegeven (masterprompt §7: hier beheerd / uit Bruto / link / koppeling niet actief). */
export function Source({ kind }: { kind: 'hier' | 'bruto' | 'link' | 'inactief' }) {
  const t = { hier: 'hier beheerd', bruto: 'uit Bruto', link: 'externe link', inactief: 'koppeling niet actief' }[kind];
  return <span className="source" title="Herkomst van dit gegeven">{t}</span>;
}

export function PhaseBar({ phase }: { phase: string }) {
  const order = ['pre_productie', 'productie', 'post_productie', 'afronding', 'operationeel_klaar', 'administratief_klaar'];
  const i = order.indexOf(phase);
  return (
    <div className="phasebar" role="img" aria-label={`Fase ${i + 1} van ${order.length}`}>
      {order.map((p, n) => <span key={p} className={n <= i ? 'on' : ''} />)}
    </div>
  );
}

/** CSV-download (UTF-8 met BOM, zodat Excel op de Mac accenten goed toont). */
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
