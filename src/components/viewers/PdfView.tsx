import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ZoomIn, ZoomOut } from '../Icons';

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
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [containerW, setContainerW] = useState(800);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  const scrollToPage = useCallback((n: number) => {
    if (!doc) return;
    const target = Math.max(1, Math.min(doc.numPages, n));
    setPage(target);
    const container = scrollRef.current;
    const el = document.getElementById(`pdf-page-${target}`);
    if (el && container) {
      const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top, behavior: 'smooth' });
    } else if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [doc]);

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

  const baseW = Math.max(280, containerW - 48);
  const targetW = Math.round(fit ? baseW : baseW * zoom);

  return (
    <div className="pdf-root">
      <div className="pdf-toolbar">
        <span className="pdf-title" title={name}>{name}</span>
        <div className="pdf-nav">
          <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => scrollToPage(page - 1)} aria-label="Previous page">‹</button>
          <span className="pdf-pageinfo">Page {page} / {doc.numPages}</span>
          <button type="button" className="btn btn-ghost" disabled={page >= doc.numPages} onClick={() => scrollToPage(page + 1)} aria-label="Next page">›</button>
        </div>
        <div className="pdf-zoom">
          <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => { setFit(false); setZoom((z) => Math.max(0.4, Math.round((z - 0.2) * 100) / 100)); }}>
            <ZoomOut size={14} />
          </button>
          <button type="button" className={`btn btn-ghost${fit ? ' on' : ''}`} onClick={() => setFit((f) => !f)} title="Toggle fit-width">
            {fit ? 'Fit width' : `${Math.round(zoom * 100)}%`}
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => { setFit(false); setZoom((z) => Math.min(4, Math.round((z + 0.2) * 100) / 100)); }}>
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
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

        // build the page DOM: canvas + optional text layer for selection
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
        try {
          const pdfjs = await import('pdfjs-dist');
          const TextLayerCtor = (pdfjs as unknown as { TextLayer?: new (o: object) => { render(): Promise<void> } }).TextLayer;
          if (TextLayerCtor) {
            const textContent = await pdfPage.getTextContent();
            const tl = new TextLayerCtor({ textContentSource: textContent, container: wrap, viewport: vp });
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

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <div className="spinner" />
      <span className="muted">{label}</span>
    </div>
  );
}
