import React from 'react';
import { useToast } from '../stores/toast';

export function Toasts() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'ok' ? '✓ ' : t.kind === 'warn' ? '⚠ ' : ''}{t.message}
        </button>
      ))}
    </div>
  );
}
