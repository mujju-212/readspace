import React from 'react';
import { useTabs } from '../../stores/tabs';
import { rendererForExt } from '../../services/fs/types';

/** Unknown file type → friendly message + "open as text" escape hatch. */
export default function UnsupportedView({ path }: { path: string }) {
  const setForceText = useTabs((s) => s.setForceText);
  const ext = path.split('.').pop() ?? '';
  return (
    <div className="empty-state">
      <div className="empty-icon">📄</div>
      <h2>Cannot preview .{ext} files</h2>
      <p>
        ReadSpace v0.1 previews <b>Markdown, PDF, DOCX, HTML, TXT</b> and images.
      </p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={() => setForceText(useTabs.getState().activeId!, true)}>
          Open as text anyway
        </button>
      </div>
    </div>
  );
}
