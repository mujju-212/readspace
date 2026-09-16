import React, { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../../stores/workspace';
import { renderMarkdown } from '../../services/assets';

/** Markdown viewer (FR-20, FR-21): GFM + sanitised + workspace-relative images. */
export default function MarkdownView({ text, path }: { text: string; path: string }) {
  const provider = useWorkspace((s) => s.provider)!;
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

  return (
    <article className="reader md-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
