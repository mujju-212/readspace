import React from 'react';

/** Minimal fallback editor (also the CodeMirror loading fallback). */
export default function PlainEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      className="plain-editor"
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const el = e.currentTarget;
          el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
          onChange(el.value);
        }
      }}
      aria-label="File editor"
    />
  );
}
