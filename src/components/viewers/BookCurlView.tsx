import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface BookCurlHandle {
  turnForward: () => Promise<void>;
  turnBackward: () => Promise<void>;
}

interface BookCurlViewProps {
  doc: PDFDocumentProxy;
  page: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  zoom?: number;
  fit?: boolean;
  docName: string;
}

/** Synthesize a soft paper rustle sound using Web Audio API (zero audio files needed). */
function playPaperTurnSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const duration = 0.09;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  } catch {
    /* audio policy / unmuted on gesture */
  }
}

/** Fast pixel-accurate canvas cloner that preserves rendered bitmaps (cloneNode clears canvas!). */
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.style.width = '100%';
  copy.style.height = '100%';
  copy.style.objectFit = 'contain';
  copy.style.display = 'block';
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(src, 0, 0);
  }
  return copy;
}

/** Mirror/verso page face for curling backface (realistic paper bleed-through) */
function cloneCanvasVerso(src: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.style.width = '100%';
  copy.style.height = '100%';
  copy.style.objectFit = 'contain';
  copy.style.display = 'block';
  copy.style.filter = 'blur(0.5px) contrast(0.8)';
  copy.style.opacity = '0.22';
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(src, 0, 0);
  }
  return copy;
}

export const BookCurlView = forwardRef<BookCurlHandle, BookCurlViewProps>(function BookCurlView(
  { doc, page, setPage, zoom = 1, fit = true, docName },
  ref,
) {
  const [aspect, setAspect] = useState(1.414);
  const [turnState, setTurnState] = useState<{
    active: boolean;
    dir: 'next' | 'prev';
    fromPage: number;
    toPage: number;
  }>({
    active: false,
    dir: 'next',
    fromPage: page,
    toPage: page,
  });

  const canvasCache = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const baseRef = useRef<HTMLDivElement>(null);
  const leafFrontRef = useRef<HTMLDivElement>(null);
  const leafBackRef = useRef<HTMLDivElement>(null);
  const isTurningRef = useRef(false);
  const prevPageRef = useRef(page);

  // Measure available scroll area dimensions with ResizeObserver for true responsive fit
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const update = () => {
      const cs = window.getComputedStyle(el);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const availW = Math.max(200, el.clientWidth - padLeft - padRight);
      const availH = Math.max(200, el.clientHeight - padTop - padBottom);
      setStageSize({ w: availW, h: availH });
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  // Render a PDF page onto an HTMLCanvasElement with devicePixelRatio & zoom caching
  const renderPdfPage = useCallback(
    async (pNum: number): Promise<HTMLCanvasElement | null> => {
      if (pNum < 1 || pNum > doc.numPages) return null;
      const cached = canvasCache.current.get(pNum);
      if (cached) return cached;

      try {
        const pdfPage = await doc.getPage(pNum);
        const vp1 = pdfPage.getViewport({ scale: 1 });
        const curAspect = vp1.height / vp1.width;
        setAspect(curAspect);

        // Render at crisp double-resolution + zoom factor for pin-sharp display at all zoom levels
        const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
        const effectiveZoom = fit ? 1 : Math.max(1, zoom);
        const baseWidth = Math.min(2400, Math.round(960 * effectiveZoom));
        const scale = (baseWidth / vp1.width) * dpr;
        const vp = pdfPage.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.objectFit = 'contain';
        canvas.style.display = 'block';

        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
        }
        await pdfPage.render({ canvasContext: ctx!, viewport: vp }).promise;
        pdfPage.cleanup();
        canvasCache.current.set(pNum, canvas);
        return canvas;
      } catch (err) {
        console.warn(`[BookCurlView] failed to render page ${pNum}:`, err);
        return null;
      }
    },
    [doc, fit, zoom],
  );

  // Clear cache when document or zoom changes
  useEffect(() => {
    canvasCache.current.clear();
    void (async () => {
      const cur = await renderPdfPage(page);
      if (cur && baseRef.current && !isTurningRef.current) {
        baseRef.current.replaceChildren(cloneCanvas(cur));
      }
    })();
  }, [doc, fit, zoom, renderPdfPage, page]);

  // When returning to Fit, gently reset scroll to top
  useEffect(() => {
    if (fit && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: 0, left: 0 });
    }
  }, [fit]);

  // Execute 3D Page Turn Forward (Page N -> N+1)
  const turnForward = useCallback(async () => {
    if (page >= doc.numPages || isTurningRef.current) return;
    isTurningRef.current = true;

    const from = page;
    const to = page + 1;

    // Ensure destination page canvas is ready
    const [fromCanvas, toCanvas] = await Promise.all([
      renderPdfPage(from),
      renderPdfPage(to),
    ]);

    if (!fromCanvas || !toCanvas) {
      setPage(to);
      isTurningRef.current = false;
      return;
    }

    // Set underneath base layer to destination page
    if (baseRef.current) {
      baseRef.current.replaceChildren(cloneCanvas(toCanvas));
    }

    // Set leaf front to current page
    if (leafFrontRef.current) {
      leafFrontRef.current.replaceChildren(cloneCanvas(fromCanvas));
    }

    // Set leaf back to mirrored / verso paper
    if (leafBackRef.current) {
      leafBackRef.current.replaceChildren(cloneCanvasVerso(fromCanvas));
    }

    playPaperTurnSound();
    setTurnState({ active: true, dir: 'next', fromPage: from, toPage: to });

    // Wait for the 3D curl animation to complete (~500ms)
    setTimeout(() => {
      setPage(to);
      prevPageRef.current = to;
      setTurnState({ active: false, dir: 'next', fromPage: to, toPage: to });
      isTurningRef.current = false;
    }, 500);
  }, [doc.numPages, page, renderPdfPage, setPage]);

  // Execute 3D Page Turn Backward (Page N -> N-1)
  const turnBackward = useCallback(async () => {
    if (page <= 1 || isTurningRef.current) return;
    isTurningRef.current = true;

    const from = page;
    const to = page - 1;

    const [fromCanvas, toCanvas] = await Promise.all([
      renderPdfPage(from),
      renderPdfPage(to),
    ]);

    if (!fromCanvas || !toCanvas) {
      setPage(to);
      isTurningRef.current = false;
      return;
    }

    // Set underneath base layer to current page
    if (baseRef.current) {
      baseRef.current.replaceChildren(cloneCanvas(fromCanvas));
    }

    // The leaf turning from the left holds destination page on its front
    if (leafFrontRef.current) {
      leafFrontRef.current.replaceChildren(cloneCanvas(toCanvas));
    }

    if (leafBackRef.current) {
      leafBackRef.current.replaceChildren(cloneCanvasVerso(toCanvas));
    }

    playPaperTurnSound();
    setTurnState({ active: true, dir: 'prev', fromPage: from, toPage: to });

    setTimeout(() => {
      setPage(to);
      prevPageRef.current = to;
      if (baseRef.current && toCanvas) {
        baseRef.current.replaceChildren(cloneCanvas(toCanvas));
      }
      setTurnState({ active: false, dir: 'prev', fromPage: to, toPage: to });
      isTurningRef.current = false;
    }, 500);
  }, [page, renderPdfPage, setPage]);

  // Expose turn handles to parent via ref
  useImperativeHandle(ref, () => ({
    turnForward,
    turnBackward,
  }));

  // Synchronize external page changes (e.g. from top toolbar or slider)
  useEffect(() => {
    if (page === prevPageRef.current) return;
    const oldP = prevPageRef.current;
    prevPageRef.current = page;

    if (page === oldP + 1 && !isTurningRef.current) {
      void turnForward();
    } else if (page === oldP - 1 && !isTurningRef.current) {
      void turnBackward();
    } else {
      // Direct jump (e.g. scrubber jump): immediately render destination
      void (async () => {
        const cur = await renderPdfPage(page);
        if (cur && baseRef.current && !isTurningRef.current) {
          baseRef.current.replaceChildren(cloneCanvas(cur));
        }
      })();
    }
  }, [page, turnForward, turnBackward, renderPdfPage]);

  // Initial render & pre-fetch
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cur = await renderPdfPage(page);
      if (!alive) return;
      if (cur && baseRef.current && !isTurningRef.current) {
        baseRef.current.replaceChildren(cloneCanvas(cur));
      }
      if (page + 1 <= doc.numPages) void renderPdfPage(page + 1);
      if (page - 1 >= 1) void renderPdfPage(page - 1);
    })();
    return () => {
      alive = false;
    };
  }, [doc, page, renderPdfPage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        void turnForward();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        void turnBackward();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [turnForward, turnBackward]);

  const leftStackWidth = Math.min(14, Math.max(3, Math.round((page / doc.numPages) * 12)));
  const rightStackWidth = Math.min(14, Math.max(3, Math.round(((doc.numPages - page) / doc.numPages) * 12)));

  // Responsive Book Sizing: Fit cleanly inside available scroll area preserving document aspect ratio
  const availH = stageSize.h > 0 ? stageSize.h : 680;
  const availW = stageSize.w > 0 ? stageSize.w - 36 : 500;

  let fitBaseH = availH;
  let fitBaseW = fitBaseH / aspect;
  if (fitBaseW > availW) {
    fitBaseW = availW;
    fitBaseH = fitBaseW * aspect;
  }

  const bookW = Math.max(200, Math.round(fit ? fitBaseW : fitBaseW * zoom));
  const bookH = Math.max(280, Math.round(fit ? fitBaseH : fitBaseH * zoom));

  return (
    <div className="rs-book-stage">
      {/* Pinned Side Page Turn Buttons (Google Play Books style - stayed fixed on viewport) */}
      <button
        type="button"
        className="rs-book-side-btn left"
        disabled={page <= 1 || turnState.active}
        onClick={() => void turnBackward()}
        title="Previous page (ArrowLeft)"
        aria-label="Previous page"
      >
        ‹
      </button>

      <button
        type="button"
        className="rs-book-side-btn right"
        disabled={page >= doc.numPages || turnState.active}
        onClick={() => void turnForward()}
        title="Next page (ArrowRight)"
        aria-label="Next page"
      >
        ›
      </button>

      {/* Overflow-Safe Scrollable Area with margin:auto centering (Zero cutoff on zoom!) */}
      <div className="rs-book-scroll-area" ref={scrollAreaRef}>
        <div
          className="rs-book-wrapper"
          style={{
            width: `${bookW}px`,
            height: `${bookH}px`,
            aspectRatio: `${1 / aspect}`,
          }}
        >
          {/* Left Stack Thickness (Pages already read) */}
          <div
            className="rs-book-edge-left"
            style={{ width: `${leftStackWidth}px` }}
            title={`${page - 1} pages read`}
          />

          {/* 3D Book Container */}
          <div className="rs-book-container">
            {/* Running Spine / Gutter Crease Shadow */}
            <div className="rs-book-spine" />

            {/* Underneath Base Layer (Visible when idle & revealed under turning leaf) */}
            <div className="rs-page-base">
              <div className="rs-canvas-host" ref={baseRef} />
              {turnState.active && <div className="rs-under-shadow" />}
            </div>

            {/* Active 3D Curling Leaf */}
            {turnState.active && (
              <div
                className={`rs-curl-leaf ${
                  turnState.dir === 'next' ? 'rs-curl-forward' : 'rs-curl-backward'
                }`}
              >
                <div className="rs-leaf-front">
                  <div className="rs-canvas-host" ref={leafFrontRef} />
                  <div className="rs-curl-lighting" />
                </div>
                <div className="rs-leaf-back">
                  <div className="rs-canvas-host" ref={leafBackRef} />
                  <div className="rs-curl-lighting-back" />
                </div>
              </div>
            )}

            {/* Interactive Tap / Click Zones */}
            <div
              className="rs-hotzone-left"
              onClick={() => void turnBackward()}
              title="Click or tap to go to previous page"
            />
            <div
              className="rs-hotzone-right"
              onClick={() => void turnForward()}
              title="Click or tap to turn to next page"
            />

            {/* Corner Peel Hover Hint (Play Books dog-ear) */}
            {page < doc.numPages && !turnState.active && (
              <div
                className="rs-corner-hint"
                onClick={() => void turnForward()}
                title="Click corner to flip page"
              >
                <div className="rs-corner-hint-peel" />
              </div>
            )}
          </div>

          {/* Right Stack Thickness (Pages remaining) */}
          <div
            className="rs-book-edge-right"
            style={{ width: `${rightStackWidth}px` }}
            title={`${doc.numPages - page} pages remaining`}
          />
        </div>
      </div>

      {/* Bottom Floating Bar with Smooth Page Scrubber & Counter (Pinned to viewport) */}
      <div className="rs-web-curl-controls">
        <button
          type="button"
          className="btn btn-ghost rs-curl-btn"
          disabled={page <= 1 || turnState.active}
          onClick={() => void turnBackward()}
          title="Previous page (ArrowLeft)"
        >
          ‹ Prev
        </button>

        <div className="rs-curl-slider-box">
          <span className="pdf-pageinfo">
            Page {page} of {doc.numPages}
          </span>
          <input
            type="range"
            min={1}
            max={doc.numPages}
            value={page}
            disabled={turnState.active}
            onChange={(e) => setPage(Number(e.target.value))}
            className="rs-curl-slider"
            title={`Slide to jump through ${doc.numPages} pages`}
          />
        </div>

        <button
          type="button"
          className="btn btn-ghost rs-curl-btn"
          disabled={page >= doc.numPages || turnState.active}
          onClick={() => void turnForward()}
          title="Next page (ArrowRight)"
        >
          Next ›
        </button>
      </div>
    </div>
  );
});
