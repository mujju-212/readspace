import React from 'react';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <div className="spinner" />
      <span className="muted">{label}</span>
    </div>
  );
}

export default Spinner;

