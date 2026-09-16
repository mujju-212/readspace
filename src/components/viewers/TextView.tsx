import React, { useState } from 'react';
import { Wrap } from '../Icons';

/** Plain-text viewer (FR-27): wrap toggle + big-file notice. */
export default function TextView({ text }: { text: string }) {
  const [wrap, setWrap] = useState(true);
  const big = text.length > 2_000_000;
  return (
    <div className="text-view">
      <div className="text-toolbar">
        <span className="muted">{text.split('\n').length.toLocaleString()} lines · {big ? 'large file' : `${(new Blob([text]).size / 1024).toFixed(1)} KB`}</span>
        <button type="button" className={`btn btn-ghost${wrap ? ' on' : ''}`} onClick={() => setWrap((w) => !w)} title="Toggle word wrap">
          <Wrap size={13} /> Wrap
        </button>
      </div>
      <div className="reader text-body">
        <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal' }}>{text}</pre>
      </div>
    </div>
  );
}
