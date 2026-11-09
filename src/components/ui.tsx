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
