import { Spinner } from '../Spinner';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ZoomIn, ZoomOut } from '../Icons';
import { copyTextToClipboard } from './TextView';
import { useSettings } from '../../stores/settings';
import { BookCurlView, type BookCurlHandle } from './BookCurlView';

/** pdf.js worker wiring — done once, lazily (TRD §9: dynamic import). */
let workerReady: Promise<void> | null = null;
function ensureWorker(): Promise<void> {
  if (!workerReady) {
    workerReady = (async () => {
      const [pdfjs, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
        (workerUrl as { default: string }).default;
    })();
  }
  return workerReady;
}

/**
 * PDF viewer (FR-22): continuous scroll, virtualised page rendering,
 * fit-width / zoom, page navigation. Selection via pdf.js text layer
 * (best effort — silently skipped if unsupported).
 */
export default function PdfView({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const mode = useSettings((s) => s.readingMode);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [viewportDims, setViewportDims] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [turnAnim, setTurnAnim] = useState<'next' | 'prev' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const curlNavRef = useRef<BookCurlHandle>(null);

  const handleCopyCurrentPage = useCallback(async () => {
    if (!doc) return;
    try {
      const pdfPage = await doc.getPage(Math.max(1, Math.min(doc.numPages, page)));
      const tc = await pdfPage.getTextContent();
      let text = '';
      for (const it of tc.items) {
        if ('str' in it) {
          text += it.str;
          text += (it as { hasEOL?: boolean }).hasEOL ? '\n' : ' ';
        }
      }
      text = text.replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').trim();
      if (!text) throw new Error('no text');
      const ok = await copyTextToClipboard(text);
      setCopyState(ok ? 'ok' : 'fail');
    } catch {
      setCopyState('fail');
    }
    setTimeout(() => setCopyState('idle'), 1600);
  }, [doc, page]);

  useEffect(() => {
    let dead = false;
    let task: { destroy: () => void } | null = null;
    void (async () => {
      try {
        await ensureWorker();
        const pdfjs = await import('pdfjs-dist');
        const data = new Uint8Array(buffer.slice(0)); // pdf.js transfers the buffer
        const task2 = pdfjs.getDocument({ data });
        task = task2 as unknown as { destroy: () => void };
        const d = await task2.promise;
        if (!dead) setDoc(d);
      } catch (e) {
        if (!dead) setErr(String((e as Error).message ?? e));
      }
    })();
    return () => {
      dead = true;
      try { void task?.destroy(); } catch { /* ignore */ }
    };
  }, [buffer]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      setViewportDims({ w: el.clientWidth, h: el.clientHeight - 42 });
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [doc]);

  const goToNextPage = useCallback(() => {
    if (!doc) return;
    setPage((p) => {
      const next = Math.min(doc.numPages, p + 1);
      if (next !== p) {
        setTurnAnim('next');
        setTimeout(() => setTurnAnim(null), 300);
      }
      return next;
    });
  }, [doc]);

  const goToPrevPage = useCallback(() => {
    if (!doc) return;
    setPage((p) => {
      const prev = Math.max(1, p - 1);
      if (prev !== p) {
        setTurnAnim('prev');
        setTimeout(() => setTurnAnim(null), 300);
      }
      return prev;
    });
  }, [doc]);

  const scrollToPage = useCallback((n: number) => {
    if (!doc) return;
    const target = Math.max(1, Math.min(doc.numPages, n));
    setPage(target);
    if (mode === 'curl') return;
    const container = scrollRef.current;
    const el = document.getElementById(`pdf-page-${target}`);
    if (el && container) {
      const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top, behavior: 'smooth' });
    } else if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [doc, mode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc) return;
    let timer: number | null = null;
    const onScroll = () => {
      if (timer !== null) return;
      timer = window.requestAnimationFrame(() => {
        timer = null;
        const pages = el.querySelectorAll<HTMLElement>('.pdf-page');
        const scrollMid = el.scrollTop + el.clientHeight / 3;
        for (const p of pages) {
          const top = p.offsetTop - el.offsetTop;
          const bottom = top + p.offsetHeight;
          if (scrollMid >= top && scrollMid < bottom) {
            const num = Number(p.dataset.pageNumber);
            if (num) setPage(num);
            break;
          }
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (timer !== null) window.cancelAnimationFrame(timer);
    };
  }, [doc]);

  useEffect(() => {
    if (mode !== 'curl') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPrevPage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, goToNextPage, goToPrevPage]);

  if (err) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <h2>Couldn't open this PDF</h2>
        <p className="muted">{err}</p>
      </div>
    );
  }
  if (!doc) return <Spinner label="Opening PDF…" />;

  // In 3D book mode, ensure entire page fits comfortably within viewport height & width
  const aspect = 1.414;
  const maxAvailableH = Math.max(300, viewportDims.h - 96);
  const maxAvailableW = Math.max(280, viewportDims.w - 140);
  const fitBookW = Math.min(maxAvailableW, Math.round(maxAvailableH / aspect));

  const baseW = Math.max(280, viewportDims.w - 48);
  const targetW = mode === 'curl'
    ? Math.round(fit ? fitBookW : fitBookW * zoom)
    : Math.round(fit ? baseW : baseW * zoom);

  return (
    <div className="pdf-root" ref={rootRef}>
      <div className="pdf-toolbar">
        <span className="pdf-title" title={name}>{name}</span>
        <div className="pdf-nav">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => {
              if (mode === 'curl') {
                void curlNavRef.current?.turnBackward();
              } else {
                scrollToPage(page - 1);
              }
            }}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="pdf-pageinfo">Page {page} / {doc.numPages}</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page >= doc.numPages}
            onClick={() => {
              if (mode === 'curl') {
                void curlNavRef.current?.turnForward();
              } else {
                scrollToPage(page + 1);
              }
            }}
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
          className="btn btn-ghost"
          title="Copy this page's text"
          onClick={handleCopyCurrentPage}
        >
          {copyState === 'ok' ? 'Copied!' : copyState === 'fail' ? 'No text found' : 'Copy page'}
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
        <BookCurlView
          ref={curlNavRef}
          doc={doc}
          page={page}
          setPage={setPage}
          zoom={zoom}
          fit={fit}
          docName={name}
        />
      ) : (
        <div className="pdf-scroll" ref={scrollRef}>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={`${i + 1}@${targetW}`}
              doc={doc}
              num={i + 1}
              targetWidth={targetW}
              onVisible={setPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc,
  num,
  targetWidth,
  onVisible,
}: {
  doc: PDFDocumentProxy;
  num: number;
  targetWidth: number;
  onVisible: (n: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(num <= 2);
  const [done, setDone] = useState(false);
  const [aspect, setAspect] = useState(1.414);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) setVisible(true);
          if (en.intersectionRatio >= 0.5) onVisible(num);
        }
      },
      { root: el.closest('.pdf-scroll'), rootMargin: '700px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [num, onVisible]);

  useEffect(() => {
    if (!visible) return;
    let dead = false;
    let renderTask: { cancel: () => void } | null = null;
    void (async () => {
      try {
        const pdfPage = await doc.getPage(num);
        if (dead) return;
        const vp1 = pdfPage.getViewport({ scale: 1 });
        setAspect(vp1.height / vp1.width);
        const scale = targetWidth / vp1.width;
        const vp = pdfPage.getViewport({ scale });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const task = pdfPage.render({
          canvasContext: ctx,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTask = task as unknown as { cancel: () => void };
        await task.promise;
        if (dead || !hostRef.current) { pdfPage.cleanup(); return; }

        // build the page DOM: canvas + transparent text layer for mouse selection & copy
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-inner';
        wrap.style.width = `${vp.width}px`;
        wrap.style.height = `${vp.height}px`;
        wrap.style.setProperty('--scale-factor', String(scale));
        wrap.style.setProperty('--total-scale-factor', String(scale));
        canvas.className = 'pdf-canvas';
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        wrap.appendChild(canvas);

        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = `${vp.width}px`;
        textLayerDiv.style.height = `${vp.height}px`;
        textLayerDiv.style.setProperty('--scale-factor', String(scale));
        textLayerDiv.style.setProperty('--total-scale-factor', String(scale));
        wrap.appendChild(textLayerDiv);

        try {
          const pdfjs = await import('pdfjs-dist');
          const TextLayerCtor = (pdfjs as unknown as { TextLayer?: new (o: object) => { render(): Promise<void> } }).TextLayer;
          if (TextLayerCtor) {
            const textContent = await pdfPage.getTextContent();
            const tl = new TextLayerCtor({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport: vp,
            });
            await tl.render();
          }
        } catch { /* text layer is best-effort */ }
        if (dead || !hostRef.current) { pdfPage.cleanup(); return; }
        hostRef.current.replaceChildren(wrap);
        setDone(true);
        pdfPage.cleanup();
      } catch {
        if (!dead) setDone(true);
      }
    })();
    return () => {
      dead = true;
      try { renderTask?.cancel(); } catch { /* ignore */ }
    };
  }, [visible, targetWidth, doc, num]);

  return (
    <div
      id={`pdf-page-${num}`}
      className="pdf-page"
      data-page-number={num}
      style={{
        width: `${targetWidth}px`,
        height: `${Math.round(targetWidth * aspect)}px`,
      }}
      ref={hostRef}
    />
  );
}

export { Spinner } from '../Spinner';
