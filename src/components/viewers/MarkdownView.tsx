import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../../stores/workspace';
import { renderMarkdown } from '../../services/assets';
import { useSettings } from '../../stores/settings';
import { copyTextToClipboard } from './TextView';
import { ZoomIn, ZoomOut } from '../Icons';
import { HtmlBookCurlView, type HtmlBookCurlHandle } from './HtmlBookCurlView';

/** Markdown viewer (FR-20, FR-21): GFM + sanitised + workspace-relative images + 3D Book Mode. */
export default function MarkdownView({ text, path }: { text: string; path: string }) {
  const provider = useWorkspace((s) => s.provider)!;
  const mode = useSettings((s) => s.readingMode);
  const [html, setHtml] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [toolMode, setToolMode] = useState<'select' | 'hand'>('select');
  const [copied, setCopied] = useState(false);
  const blobUrls = useRef<string[]>([]);
  const curlNavRef = useRef<HtmlBookCurlHandle>(null);

  useEffect(() => {
    let alive = true;
    void renderMarkdown(text, path, provider).then((out) => {
      if (!alive) return;
      blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrls.current = out.blobUrls;
      setHtml(out.html);
    });
    return () => {
      alive = false;
    };
  }, [text, path, provider]);

  useEffect(() => () => {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // Clamp page if out of bounds
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleCopyCurrentPage = useCallback(async () => {
    if (mode === 'curl') {
      const article = document.querySelector('.markdown-view .rs-page-base .rs-html-page-article') as HTMLElement | null;
      const plain = (article?.textContent || article?.innerText || '').trim();
      const ok = await copyTextToClipboard(plain || text);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1600);
    } else {
      const ok = await copyTextToClipboard(text);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1600);
    }
  }, [mode, text]);

  const lineCount = text.split('\n').length;
  const wordCount = (text.match(/\S+/g) || []).length;
  const name = path.split('/').pop() || path;

  return (
    <div className="markdown-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {mode === 'curl' ? (
        <div className="pdf-toolbar">
          <span className="pdf-title" title={path}>
            {name} · {wordCount.toLocaleString()} words
          </span>

          <div className="pdf-nav">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page <= 1}
              onClick={() => void curlNavRef.current?.turnBackward()}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="pdf-pageinfo">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page >= totalPages}
              onClick={() => void curlNavRef.current?.turnForward()}
              aria-label="Next page"
            >
              ›
            </button>
          </div>

          <div className="pdf-zoom">
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom out"
              onClick={() => {
                setFit(false);
                setZoom((z) => Math.max(0.4, Math.round((z - 0.15) * 100) / 100));
              }}
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              className={`btn btn-ghost${fit ? ' on' : ''}`}
              onClick={() => {
                if (fit) {
                  setFit(false);
                  setZoom(1);
                } else {
                  setFit(true);
                  setZoom(1);
                }
              }}
              title="Toggle fit page"
            >
              {fit ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom in"
              onClick={() => {
                setFit(false);
                setZoom((z) => Math.min(3, Math.round((z + 0.15) * 100) / 100));
              }}
            >
              <ZoomIn size={14} />
            </button>
          </div>

          <button
            type="button"
            className={`btn btn-ghost${toolMode === 'hand' ? ' on' : ''}`}
            title={
              toolMode === 'hand'
                ? 'Drag Scroll active: Click and drag anywhere to pan document'
                : 'Text Select active: Click and drag over text to select and copy'
            }
            onClick={() => setToolMode((m) => (m === 'hand' ? 'select' : 'hand'))}
          >
            {toolMode === 'hand' ? '✋ Drag Scroll' : '👆 Select Text'}
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            title="Copy this page's text"
            onClick={handleCopyCurrentPage}
          >
            {copied ? 'Copied!' : 'Copy page'}
          </button>

          <button
            type="button"
            className="btn btn-ghost on"
            title="Toggle 3D Page Turn vs Continuous Scroll"
            onClick={() => useSettings.getState().set({ readingMode: 'scroll' })}
          >
            📖 3D Mode
          </button>
        </div>
      ) : (
        <div className="text-toolbar">
          <span className="muted" title={path} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
            {name} · {lineCount.toLocaleString()} lines · {wordCount.toLocaleString()} words
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            title="Copy markdown text"
            onClick={handleCopyCurrentPage}
          >
            {copied ? 'Copied!' : 'Copy markdown'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            title="Toggle 3D Page Turn vs Continuous Scroll"
            onClick={() => useSettings.getState().set({ readingMode: 'curl' })}
          >
            📜 Scroll Mode
          </button>
        </div>
      )}

      {mode === 'curl' ? (
        <HtmlBookCurlView
          ref={curlNavRef}
          rawHtml={html}
          page={page}
          setPage={setPage}
          onTotalPagesChange={setTotalPages}
          zoom={zoom}
          fit={fit}
          docName={name}
          toolMode={toolMode}
          setToolMode={setToolMode}
        />
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <article className="reader md-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  );
}
