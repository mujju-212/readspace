import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth/mammoth.browser.min.js';
import { Spinner } from './PdfView';
import { copyTextToClipboard } from './TextView';

/**
 * Word document viewer (FR-24): mammoth converts DOCX → semantic HTML,
 * sanitised, then styled with the reader typography.
 */
export default function DocxView({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    return () => { alive = false; };
  }, [buffer, name]);

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

  const handleCopyText = async () => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const plain = (temp.textContent || temp.innerText || '').trim();
    if (!plain) return;
    const ok = await copyTextToClipboard(plain);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="docx-view">
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
      </div>
      <div className="docx-scroll">
        <div className="reader docx-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
