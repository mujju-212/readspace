import React, { useEffect, useState } from 'react';
import { useWorkspace } from '../../stores/workspace';
import { buildSandboxedHtml } from '../../services/assets';
import TextView from './TextView';
import { Eye, Pencil } from '../Icons';

/**
 * HTML viewer (FR-26): rendered in a sandboxed iframe. Scripts are OFF by
 * default; the user can enable them per file (still fully sandboxed — the
 * page never gets access to this app, the workspace or permissions).
 */
export default function HtmlView({ text, path }: { text: string; path: string }) {
  const provider = useWorkspace((s) => s.provider)!;
  const [srcDoc, setSrcDoc] = useState<{ html: string; allows: boolean }>({ html: '', allows: false });
  const [showSource, setShowSource] = useState(false);
  const [allowScripts, setAllowScripts] = useState(false);

  useEffect(() => {
    let alive = true;
    void buildSandboxedHtml(text, path, provider, allowScripts).then((out) => {
      if (alive) setSrcDoc({ html: out.html, allows: allowScripts });
    });
    return () => { alive = false; };
  }, [text, path, provider, allowScripts]);

  return (
    <div className="html-view">
      <div className="text-toolbar">
        <span className="muted">
          Sandboxed preview — scripts {allowScripts ? 'enabled (isolated)' : 'disabled'}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className={`btn btn-ghost${!showSource ? ' on' : ''}`}
          onClick={() => setShowSource(false)}
          title="Rendered preview"
        >
          <Eye size={13} /> Preview
        </button>
        <button
          type="button"
          className={`btn btn-ghost${showSource ? ' on' : ''}`}
          onClick={() => setShowSource(true)}
          title="View HTML source"
        >
          <Pencil size={13} /> Source
        </button>
        <button
          type="button"
          className={`btn btn-ghost${allowScripts ? ' on' : ''}`}
          onClick={() => setAllowScripts((v) => !v)}
          title="Allow JavaScript from this file. It still runs fully sandboxed — no access to this app, your folder or cookies."
        >
          Scripts {allowScripts ? 'on' : 'off'}
        </button>
      </div>
      {showSource ? (
        <TextView text={text} />
      ) : (
        <iframe
          key={allowScripts ? 'js-on' : 'js-off'}
          className="html-frame"
          sandbox={allowScripts ? 'allow-scripts' : ''}
          srcDoc={srcDoc.allows === allowScripts ? srcDoc.html : ''}
          title={path}
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
