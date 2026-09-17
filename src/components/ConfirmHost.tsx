import React, { useEffect } from 'react';
import { useConfirm } from '../stores/confirm';

/** Modal host for confirmDialog() — rendered once by App. */
export function ConfirmHost() {
  const message = useConfirm((s) => s.message);
  const confirmLabel = useConfirm((s) => s.confirmLabel);
  const options = useConfirm((s) => s.options);
  const answer = useConfirm((s) => s.answer);
  const answerValue = useConfirm((s) => s.answerValue);

  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { options ? answerValue('__cancel__') : answer(false); }
      if (e.key === 'Enter' && !options) answer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, answer]);

  if (!message) return null;
  return (
    <div className="overlay confirm-overlay" onClick={() => answer(false)}>
      <div className="confirm-box" role="alertdialog" aria-modal="true" aria-label={message} onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
        <div className="confirm-actions">
          {options ? (
            <>
              <button type="button" className="btn" onClick={() => answerValue('__cancel__')}>Cancel</button>
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  autoFocus
                  className={`btn${o.kind === 'danger' ? ' btn-danger' : o.kind === 'primary' ? ' btn-primary' : ''}`}
                  onClick={() => answerValue(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => answer(false)}>
                Keep editing
              </button>
              <button type="button" className="btn btn-danger" autoFocus onClick={() => answer(true)}>
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
