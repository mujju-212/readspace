import React, { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../../stores/workspace';
import { renderMarkdown } from '../../services/assets';
import { useSettings } from '../../stores/settings';

/** Markdown viewer (FR-20, FR-21): GFM + sanitised + workspace-relative images. */
export default function MarkdownView({ text, path }: { text: string; path: string }) {
  const provider = useWorkspace((s) => s.provider)!;
  const mode = useSettings((s) => s.readingMode);
  const [html, setHtml] = useState('');
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

  if (mode === 'curl') {
    return (
      <div className="rs-web-book-stage">
        <div className="rs-web-book-container" style={{ width: 'min(840px, 92vw)', minHeight: '75vh', alignItems: 'flex-start' }}>
          <div className="rs-page-crease" />
          <article className="reader md-body" style={{ width: '100%', padding: '30px 36px' }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    );
  }

  return (
    <article className="reader md-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
