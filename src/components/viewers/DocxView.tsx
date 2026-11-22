import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth/mammoth.browser.min.js';
import { Spinner } from '../Spinner';
import { copyTextToClipboard } from './TextView';
import { useSettings } from '../../stores/settings';
import { ZoomIn, ZoomOut } from '../Icons';
import { HtmlBookCurlView, type HtmlBookCurlHandle } from './HtmlBookCurlView';

/**
 * Word document viewer (FR-24): mammoth converts DOCX → semantic HTML,
 * sanitised, then rendered with 3D Book Mode or continuous scroll typography.
 */
export default function DocxView({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const mode = useSettings((s) => s.readingMode);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [toolMode, setToolMode] = useState<'select' | 'hand'>('select');
  const [copied, setCopied] = useState(false);
  const curlNavRef = useRef<HtmlBookCurlHandle>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer.slice(0) });
        if (!alive) return;
        setHtml(DOMPurify.sanitize(result.value));
        if (result.messages.length > 0) {
          // eslint-disable-next-line no-console
          console.info(`[readspace] mammoth notes for ${name}:`, result.messages.slice(0, 5));
        }
      } catch (e) {
        if (alive) setErr(String((e as Error).message ?? e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [buffer, name]);

  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleCopyText = useCallback(async () => {
    if (mode === 'curl') {
      const article = document.querySelector('.docx-view .rs-page-base .rs-html-page-article') as HTMLElement | null;
      const plain = (article?.textContent || article?.innerText || '').trim();
      if (!plain) return;
      const ok = await copyTextToClipboard(plain);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1600);
    } else {
      if (!html) return;
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const plain = (temp.textContent || temp.innerText || '').trim();
      if (!plain) return;
      const ok = await copyTextToClipboard(plain);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1600);
    }
  }, [html, mode]);

  if (err) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <h2>Couldn't convert this document</h2>
        <p className="muted">{err}</p>
      </div>
    );
  }
  if (html === null) return <Spinner label="Converting document…" />;

  return (
    <div className="docx-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {mode === 'curl' ? (
        <div className="pdf-toolbar">
          <span className="pdf-title" title={name}>
            {name}
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
            onClick={handleCopyText}
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
          <span className="muted" title={name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
            {name}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            title="Copy full document text"
            onClick={handleCopyText}
          >
            {copied ? 'Copied!' : 'Copy text'}
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
        <div className="docx-scroll">
          <div className="reader docx-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  );
}
