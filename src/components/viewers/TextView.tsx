import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import hljs from 'highlight.js/lib/common';
import { Wrap, ZoomIn, ZoomOut } from '../Icons';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { HtmlBookCurlView, type HtmlBookCurlHandle } from './HtmlBookCurlView';
import { paginatePlainText } from '../../services/htmlPaginator';

const textPageMemory = new Map<string, number>();

const EXT_TO_LANG: Record<string, { lang: string; label: string }> = {
  js: { lang: 'javascript', label: 'JavaScript' },
  mjs: { lang: 'javascript', label: 'JavaScript' },
  cjs: { lang: 'javascript', label: 'JavaScript' },
  jsx: { lang: 'javascript', label: 'JavaScript React' },
  ts: { lang: 'typescript', label: 'TypeScript' },
  mts: { lang: 'typescript', label: 'TypeScript' },
  cts: { lang: 'typescript', label: 'TypeScript' },
  tsx: { lang: 'typescript', label: 'TypeScript React' },
  py: { lang: 'python', label: 'Python' },
  pyw: { lang: 'python', label: 'Python' },
  r: { lang: 'r', label: 'R' },
  c: { lang: 'c', label: 'C' },
  h: { lang: 'c', label: 'C Header' },
  cpp: { lang: 'cpp', label: 'C++' },
  hpp: { lang: 'cpp', label: 'C++ Header' },
  cc: { lang: 'cpp', label: 'C++' },
  cxx: { lang: 'cpp', label: 'C++' },
  cs: { lang: 'csharp', label: 'C#' },
  java: { lang: 'java', label: 'Java' },
  go: { lang: 'go', label: 'Go' },
  rs: { lang: 'rust', label: 'Rust' },
  swift: { lang: 'swift', label: 'Swift' },
  kt: { lang: 'kotlin', label: 'Kotlin' },
  kts: { lang: 'kotlin', label: 'Kotlin Script' },
  dart: { lang: 'dart', label: 'Dart' },
  scala: { lang: 'scala', label: 'Scala' },
  php: { lang: 'php', label: 'PHP' },
  rb: { lang: 'ruby', label: 'Ruby' },
  lua: { lang: 'lua', label: 'Lua' },
  sh: { lang: 'bash', label: 'Shell' },
  bash: { lang: 'bash', label: 'Bash' },
  zsh: { lang: 'bash', label: 'Zsh' },
  fish: { lang: 'bash', label: 'Fish' },
  ps1: { lang: 'powershell', label: 'PowerShell' },
  psm1: { lang: 'powershell', label: 'PowerShell' },
  bat: { lang: 'cmd', label: 'Batch' },
  cmd: { lang: 'cmd', label: 'Command' },
  sql: { lang: 'sql', label: 'SQL' },
  json: { lang: 'json', label: 'JSON' },
  jsonc: { lang: 'json', label: 'JSON with Comments' },
  yml: { lang: 'yaml', label: 'YAML' },
  yaml: { lang: 'yaml', label: 'YAML' },
  toml: { lang: 'ini', label: 'TOML' },
  ini: { lang: 'ini', label: 'INI' },
  conf: { lang: 'ini', label: 'Config' },
  env: { lang: 'ini', label: 'Env' },
  properties: { lang: 'ini', label: 'Properties' },
  dockerfile: { lang: 'dockerfile', label: 'Dockerfile' },
  makefile: { lang: 'makefile', label: 'Makefile' },
  gitignore: { lang: 'ini', label: 'Git Ignore' },
  xml: { lang: 'xml', label: 'XML' },
  css: { lang: 'css', label: 'CSS' },
  scss: { lang: 'scss', label: 'SCSS' },
  sass: { lang: 'scss', label: 'Sass' },
  less: { lang: 'less', label: 'Less' },
  diff: { lang: 'diff', label: 'Diff' },
  patch: { lang: 'diff', label: 'Patch' },
};

/** Copy arbitrary text using the Clipboard API with a textarea fallback. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.contain = 'strict';
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.fontSize = '12pt';
    document.body.appendChild(ta);

    const selection = document.getSelection();
    const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(ta);

    if (selection && originalRange) {
      selection.removeAllRanges();
      selection.addRange(originalRange);
    }
    return ok;
  } catch {
    return false;
  }
}

/** Text and code viewer with syntax highlighting (FR-27) + 3D Book Mode. */
export default function TextView({
  text,
  ext,
  name,
  path,
}: {
  text: string;
  ext?: string;
  name?: string;
  path?: string;
}) {
  const mode = useSettings((s) => s.readingMode);
  const providerId = useWorkspace((s) => s.provider?.id ?? 'local');
  const memKey = `${providerId}::${path || name || 'text'}`;
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [page, setPageState] = useState(() => textPageMemory.get(memKey) ?? 1);
  const [totalPages, setTotalPages] = useState(1);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [toolMode, setToolMode] = useState<'select' | 'hand'>('select');
  const rootRef = useRef<HTMLDivElement>(null);
  const curlNavRef = useRef<HtmlBookCurlHandle>(null);

  const setPage = useCallback(
    (next: number | ((prev: number) => number)) => {
      setPageState((prev) => {
        const val = typeof next === 'function' ? next(prev) : next;
        textPageMemory.set(memKey, val);
        return val;
      });
    },
    [memKey],
  );

  useEffect(() => {
    setPageState(textPageMemory.get(memKey) ?? 1);
  }, [memKey]);

  const big = text.length > 2_000_000;
  const info = ext ? EXT_TO_LANG[ext.toLowerCase()] : undefined;
  const isCode = Boolean(info);
  const langLabel = info?.label ?? (ext ? ext.toUpperCase() : 'Plain Text');
  const docName = name || (ext ? `file.${ext}` : 'Text Document');

  const highlightedHtml = useMemo(() => {
    if (big || text.length > 500_000) return null;
    try {
      if (info?.lang && hljs.getLanguage(info.lang)) {
        return hljs.highlight(text, { language: info.lang, ignoreIllegals: true }).value;
      }
      if (isCode) {
        return hljs.highlightAuto(text).value;
      }
    } catch {
      // fallback
    }
    return null;
  }, [text, info?.lang, isCode, big]);

  const useDomPagination = !big && text.length <= 500_000;

  const codeRawHtml = useMemo(() => {
    if (!useDomPagination) return undefined;
    const inner =
      highlightedHtml ??
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre class="hljs" style="margin:0; white-space:pre-wrap; word-break:break-word;"><code>${inner}</code></pre>`;
  }, [useDomPagination, highlightedHtml, text]);

  // Fallback line-chunked pagination only for huge files (> 500 KB)
  const rawPages = useMemo(() => {
    if (useDomPagination) return [];
    return paginatePlainText(text, { maxLinesPerPage: 32 });
  }, [text, useDomPagination]);

  const htmlPages = useMemo(() => {
    if (useDomPagination) return undefined;
    return rawPages.map((pageText) => {
      const pageHtml = pageText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre class="hljs" style="margin:0; white-space:pre-wrap; word-break:break-word;">${pageHtml}</pre>`;
    });
  }, [rawPages, useDomPagination]);

  useEffect(() => {
    if (!useDomPagination) {
      setTotalPages(Math.max(1, rawPages.length));
    }
  }, [useDomPagination, rawPages.length]);

  const handleCopy = useCallback(async () => {
    if (mode === 'curl') {
      const article = rootRef.current?.querySelector('.rs-page-base .rs-html-page-article') as HTMLElement | null;
      const pageText =
        (article?.textContent || article?.innerText || '').trim() ||
        rawPages[Math.max(0, Math.min(rawPages.length - 1, page - 1))] ||
        text;
      const ok = await copyTextToClipboard(pageText);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1600);
    } else {
      const ok = await copyTextToClipboard(text);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1600);
    }
  }, [mode, page, rawPages, text]);

  return (
    <div ref={rootRef} className="text-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {mode === 'curl' ? (
        <div className="pdf-toolbar">
          <span className="pdf-title" title={docName}>
            {docName} · {text.split('\n').length.toLocaleString()} lines · {langLabel}
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
            onClick={handleCopy}
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
          <span className="muted">
            {text.split('\n').length.toLocaleString()} lines · {big ? 'large file' : `${(new Blob([text]).size / 1024).toFixed(1)} KB`} · {langLabel}
          </span>
          <button
            type="button"
            className={`btn btn-ghost${wrap ? ' on' : ''}`}
            onClick={() => setWrap((w) => !w)}
            title="Toggle word wrap"
          >
            <Wrap size={13} /> Wrap
          </button>
          {!big && (
            <button
              type="button"
              className="btn btn-ghost"
              title="Copy full text"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy text'}
            </button>
          )}
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
          rawHtml={codeRawHtml}
          pages={htmlPages}
          page={page}
          setPage={setPage}
          onTotalPagesChange={setTotalPages}
          zoom={zoom}
          fit={fit}
          docName={docName}
          toolMode={toolMode}
          setToolMode={setToolMode}
          isCode={true}
        />
      ) : (
        <div className="reader text-body" style={{ flex: 1, overflow: 'auto' }}>
          {highlightedHtml ? (
            <pre
              className="hljs"
              style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal' }}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal' }}>
              {text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
