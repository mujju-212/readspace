import React, { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../../stores/workspace';
import { renderMarkdown } from '../../services/assets';
import { useSettings } from '../../stores/settings';
import { copyTextToClipboard } from './TextView';

/** Markdown viewer (FR-20, FR-21): GFM + sanitised + workspace-relative images. */
export default function MarkdownView({ text, path }: { text: string; path: string }) {
  const provider = useWorkspace((s) => s.provider)!;
  const mode = useSettings((s) => s.readingMode);
  const [html, setHtml] = useState('');
  const [copied, setCopied] = useState(false);
  const blobUrls = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    void renderMarkdown(text, path, provider).then((out) => {
      if (!alive) return;
      blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrls.current = out.blobUrls;
      setHtml(out.html);
    });
    return () => { alive = false; };
  }, [text, path, provider]);

  useEffect(() => () => {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1600);
  };

  const lineCount = text.split('\n').length;
  const wordCount = (text.match(/\S+/g) || []).length;
  const name = path.split('/').pop() || path;

  return (
    <div className="markdown-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="text-toolbar">
        <span className="muted" title={path} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
          {name} · {lineCount.toLocaleString()} lines · {wordCount.toLocaleString()} words
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          title="Copy markdown text"
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy markdown'}
        </button>
        <button
          type="button"
          className={`btn btn-ghost${mode === 'curl' ? ' on' : ''}`}
          title="Toggle 3D Page Turn vs Continuous Scroll"
          onClick={() => useSettings.getState().set({ readingMode: mode === 'curl' ? 'scroll' : 'curl' })}
        >
          {mode === 'curl' ? '📖 3D Mode' : '📜 Scroll Mode'}
        </button>
      </div>

      {mode === 'curl' ? (
        <div className="rs-web-book-stage" style={{ flex: 1, overflow: 'auto' }}>
          <div className="rs-web-book-container" style={{ width: 'min(860px, 92vw)', minHeight: '80vh', alignItems: 'flex-start', margin: '20px 0' }}>
            <div className="rs-page-crease" />
            <article className="reader md-body" style={{ width: '100%', padding: '36px 44px' }} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <article className="reader md-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  );
}
