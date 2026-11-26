import React, {
  useState,
  useEffect,
  useLayoutEffect,
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
  toolMode?: 'select' | 'hand';
  setToolMode?: (mode: 'select' | 'hand') => void;
}

const MAX_CACHED_CANVASES = 16;

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
  copy.style.transform = 'scaleX(-1)';
  copy.style.filter = 'blur(0.5px) contrast(0.85)';
  copy.style.opacity = '0.28';
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(src, 0, 0);
  }
  return copy;
}

export const BookCurlView = forwardRef<BookCurlHandle, BookCurlViewProps>(function BookCurlView(
  { doc, page, setPage, zoom = 1, fit = true, toolMode = 'select' },
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
  const textContentCache = useRef<Map<number, unknown>>(new Map());
  const pageAspectsRef = useRef<Map<number, number>>(new Map());
  const activePageRef = useRef(page);
  activePageRef.current = page;

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const baseRef = useRef<HTMLDivElement>(null);
  const textLayerHostRef = useRef<HTMLDivElement>(null);
  const leafFrontRef = useRef<HTMLDivElement>(null);
  const leafBackRef = useRef<HTMLDivElement>(null);
  const pendingTurnCanvasesRef = useRef<{ front: HTMLCanvasElement; back: HTMLCanvasElement } | null>(null);
  const isTurningRef = useRef(false);
  const turnTimerRef = useRef<number | null>(null);
  const textLayerSeqRef = useRef(0);
  const bookWRef = useRef(500);

  useEffect(() => {
    return () => {
      if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    };
  }, []);

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
      setStageSize((prev) =>
        Math.abs(prev.w - availW) >= 2 || Math.abs(prev.h - availH) >= 2
          ? { w: availW, h: availH }
          : prev,
      );
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  // Render a PDF page onto an HTMLCanvasElement with LRU caching & per-page aspect tracking
  const renderPdfPage = useCallback(
    async (pNum: number): Promise<HTMLCanvasElement | null> => {
      if (pNum < 1 || pNum > doc.numPages) return null;
      const cached = canvasCache.current.get(pNum);
      if (cached) {
        // Refresh LRU order
        canvasCache.current.delete(pNum);
        canvasCache.current.set(pNum, cached);
        const knownAspect = pageAspectsRef.current.get(pNum);
        if (knownAspect && pNum === activePageRef.current) {
          setAspect(knownAspect);
        }
        return cached;
      }

      try {
        const pdfPage = await doc.getPage(pNum);
        const vp1 = pdfPage.getViewport({ scale: 1 });
        const curAspect = vp1.height / vp1.width;
        pageAspectsRef.current.set(pNum, curAspect);
        if (pNum === activePageRef.current) {
          setAspect(curAspect);
        }

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

        // Evict oldest cached canvas if over LRU limit (never evict active page)
        if (canvasCache.current.size >= MAX_CACHED_CANVASES) {
          for (const key of canvasCache.current.keys()) {
            if (key !== activePageRef.current) {
              canvasCache.current.delete(key);
              break;
            }
          }
        }
        canvasCache.current.set(pNum, canvas);
        return canvas;
      } catch (err) {
        console.warn(`[BookCurlView] failed to render page ${pNum}:`, err);
        return null;
      }
    },
    [doc, fit, zoom],
  );

  // Render text layer for text selection & copy in 3D book mode
  const renderTextLayer = useCallback(
    async (pNum: number, currentBookW: number) => {
      const host = textLayerHostRef.current;
      if (!host || pNum < 1 || pNum > doc.numPages) return;
      const seq = ++textLayerSeqRef.current;

      try {
        const pdfPage = await doc.getPage(pNum);
        if (seq !== textLayerSeqRef.current) return;
        const vp1 = pdfPage.getViewport({ scale: 1 });
        const scale = currentBookW / vp1.width;
        const vp = pdfPage.getViewport({ scale });

        let textContent = textContentCache.current.get(pNum);
        if (!textContent) {
          textContent = await pdfPage.getTextContent();
          textContentCache.current.set(pNum, textContent);
        }
        if (seq !== textLayerSeqRef.current) return;

        const pdfjs = await import('pdfjs-dist');
        if (seq !== textLayerSeqRef.current) return;
        const TextLayerCtor = (
          pdfjs as unknown as {
            TextLayer?: new (o: object) => { render(): Promise<void> };
          }
        ).TextLayer;

        if (TextLayerCtor && textLayerHostRef.current) {
          const targetHost = textLayerHostRef.current;
          targetHost.replaceChildren();
          targetHost.style.width = '100%';
          targetHost.style.height = '100%';
          targetHost.style.setProperty('--scale-factor', String(scale));
          targetHost.style.setProperty('--total-scale-factor', String(scale));

          const tl = new TextLayerCtor({
            textContentSource: textContent,
            container: targetHost,
            viewport: vp,
          });
          await tl.render();
        }
      } catch (err) {
        console.warn('[BookCurlView] failed to render textLayer:', err);
      }
    },
    [doc],
  );

  // Clear text & aspect caches and cancel any in-flight turn when document changes
  useEffect(() => {
    textContentCache.current.clear();
    pageAspectsRef.current.clear();
    if (turnTimerRef.current !== null) {
      window.clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    pendingTurnCanvasesRef.current = null;
    isTurningRef.current = false;
    setTurnState({ active: false, dir: 'next', fromPage: activePageRef.current, toPage: activePageRef.current });
  }, [doc]);

  // Clear bitmap canvas cache only when document or zoom/fit changes (NOT on page turns!)
  useEffect(() => {
    canvasCache.current.clear();
  }, [doc, fit, zoom]);

  // Populate curling leaf front & back synchronously right after React mounts .rs-curl-leaf
  useLayoutEffect(() => {
    if (!turnState.active || !pendingTurnCanvasesRef.current) return;
    const { front, back } = pendingTurnCanvasesRef.current;
    if (leafFrontRef.current) {
      leafFrontRef.current.replaceChildren(front);
    }
    if (leafBackRef.current) {
      leafBackRef.current.replaceChildren(back);
    }
  }, [turnState]);

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

    // Clear text layer while turning so it doesn't float over the curling leaf
    textLayerSeqRef.current++;
    if (textLayerHostRef.current) {
      textLayerHostRef.current.replaceChildren();
    }

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

    // Stage front & verso canvases for useLayoutEffect to mount onto .rs-curl-leaf
    pendingTurnCanvasesRef.current = {
      front: cloneCanvas(fromCanvas),
      back: cloneCanvasVerso(fromCanvas),
    };

    const toAspect = pageAspectsRef.current.get(to);
    if (toAspect) setAspect(toAspect);

    playPaperTurnSound();
    setTurnState({ active: true, dir: 'next', fromPage: from, toPage: to });

    turnTimerRef.current = window.setTimeout(() => {
      pendingTurnCanvasesRef.current = null;
      setPage(to);
      setTurnState({ active: false, dir: 'next', fromPage: to, toPage: to });
      isTurningRef.current = false;
      void renderTextLayer(to, bookWRef.current);
    }, 580);
  }, [doc.numPages, page, renderPdfPage, renderTextLayer, setPage]);

  // Execute 3D Page Turn Backward (Page N -> N-1)
  const turnBackward = useCallback(async () => {
    if (page <= 1 || isTurningRef.current) return;
    isTurningRef.current = true;

    const from = page;
    const to = page - 1;

    textLayerSeqRef.current++;
    if (textLayerHostRef.current) {
      textLayerHostRef.current.replaceChildren();
    }

    const [fromCanvas, toCanvas] = await Promise.all([
      renderPdfPage(from),
      renderPdfPage(to),
    ]);

    if (!fromCanvas || !toCanvas) {
      setPage(to);
      isTurningRef.current = false;
      return;
    }

    // Set underneath base layer to current page while previous page flips back over it
    if (baseRef.current) {
      baseRef.current.replaceChildren(cloneCanvas(fromCanvas));
    }

    pendingTurnCanvasesRef.current = {
      front: cloneCanvas(toCanvas),
      back: cloneCanvasVerso(toCanvas),
    };

    const toAspect = pageAspectsRef.current.get(to);
    if (toAspect) setAspect(toAspect);

    playPaperTurnSound();
    setTurnState({ active: true, dir: 'prev', fromPage: from, toPage: to });

    turnTimerRef.current = window.setTimeout(() => {
      pendingTurnCanvasesRef.current = null;
      if (baseRef.current && toCanvas) {
        baseRef.current.replaceChildren(cloneCanvas(toCanvas));
      }
      setPage(to);
      setTurnState({ active: false, dir: 'prev', fromPage: to, toPage: to });
      isTurningRef.current = false;
      void renderTextLayer(to, bookWRef.current);
    }, 580);
  }, [page, renderPdfPage, renderTextLayer, setPage]);

  // Expose turn handles to parent via ref
  useImperativeHandle(ref, () => ({
    turnForward,
    turnBackward,
  }));

  // Render active page (from cache or pdf.js) + pre-fetch neighbors
  useEffect(() => {
    let alive = true;
    const knownAspect = pageAspectsRef.current.get(page);
    if (knownAspect) setAspect(knownAspect);

    void (async () => {
      const cur = await renderPdfPage(page);
      if (!alive) return;
      if (cur && baseRef.current && !isTurningRef.current) {
        baseRef.current.replaceChildren(cloneCanvas(cur));
      }
      if (!isTurningRef.current) {
        void renderTextLayer(page, bookWRef.current);
      }
      if (page + 1 <= doc.numPages) void renderPdfPage(page + 1);
      if (page - 1 >= 1) void renderPdfPage(page - 1);
    })();
    return () => {
      alive = false;
    };
  }, [doc, page, fit, zoom, renderPdfPage, renderTextLayer]);

  // Keyboard navigation (single owner in 3D mode)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        void turnForward();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        void turnBackward();
      } else if (e.key === 'Home' && !turnState.active) {
        e.preventDefault();
        setPage(1);
      } else if (e.key === 'End' && !turnState.active) {
        e.preventDefault();
        setPage(doc.numPages);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [turnForward, turnBackward, turnState.active, setPage, doc.numPages]);

  const leftStackWidth = Math.min(14, Math.max(3, Math.round((page / doc.numPages) * 12)));
  const rightStackWidth = Math.min(14, Math.max(3, Math.round(((doc.numPages - page) / doc.numPages) * 12)));

  // Responsive Book Sizing: Fit cleanly inside available scroll area with curl clearance
  const availH = stageSize.h > 0 ? Math.max(240, stageSize.h - 32) : 650;
  const availW = stageSize.w > 0 ? stageSize.w - 36 : 500;

  let fitBaseH = availH;
  let fitBaseW = fitBaseH / aspect;
  if (fitBaseW > availW) {
    fitBaseW = availW;
    fitBaseH = fitBaseW * aspect;
  }

  const bookW = Math.max(200, Math.round(fit ? fitBaseW : fitBaseW * zoom));
  const bookH = Math.max(280, Math.round(fit ? fitBaseH : fitBaseH * zoom));
  bookWRef.current = bookW;

  // Re-align textLayer whenever bookW changes (e.g. window resize, sidebar toggle, Zen mode)
  useEffect(() => {
    if (!isTurningRef.current) {
      void renderTextLayer(page, bookW);
    }
  }, [bookW, page, renderTextLayer]);

  // Drag Scrolling (Pan) controller & Touch Swipe Gesture
  const isDraggingScroll = useRef(false);
  const dragScrollStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const [isGrabbing, setIsGrabbing] = useState(false);
  const touchSwipeRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, .rs-corner-hint, .rs-web-curl-controls')) return;

    const isDesk = !(e.target as HTMLElement).closest('.rs-book-container');
    const isHand = toolMode === 'hand';
    const isMiddle = e.button === 1;

    if (isHand || isDesk || isMiddle) {
      if (scrollAreaRef.current) {
        isDraggingScroll.current = true;
        dragScrollStart.current = {
          x: e.clientX,
          y: e.clientY,
          left: scrollAreaRef.current.scrollLeft,
          top: scrollAreaRef.current.scrollTop,
        };
        setIsGrabbing(true);
        e.preventDefault();
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingScroll.current && scrollAreaRef.current) {
      const dx = e.clientX - dragScrollStart.current.x;
      const dy = e.clientY - dragScrollStart.current.y;
      scrollAreaRef.current.scrollLeft = dragScrollStart.current.left - dx;
      scrollAreaRef.current.scrollTop = dragScrollStart.current.top - dy;
    }
  };

  const handleMouseUp = () => {
    if (isDraggingScroll.current) {
      isDraggingScroll.current = false;
      setIsGrabbing(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      touchSwipeRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    } else {
      touchSwipeRef.current = null;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchSwipeRef.current || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchSwipeRef.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - touchSwipeRef.current.y);
    const elapsed = Date.now() - touchSwipeRef.current.time;
    touchSwipeRef.current = null;

    if (Math.abs(dx) > 55 && dy < 90 && elapsed < 700 && !turnState.active) {
      if (dx < 0 && page < doc.numPages) {
        void turnForward();
      } else if (dx > 0 && page > 1) {
        void turnBackward();
      }
    }
  };

  useEffect(() => {
    const onUp = () => {
      isDraggingScroll.current = false;
      setIsGrabbing(false);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

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

      {/* Overflow-Safe Scrollable Area with Drag Scrolling & Panning */}
      <div
        className={`rs-book-scroll-area${toolMode === 'hand' ? ' mode-hand' : ''}${
          isGrabbing ? ' is-grabbing' : ''
        }`}
        ref={scrollAreaRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
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

            {/* Underneath Base Layer with Selectable TextLayer */}
            <div className="rs-page-base">
              <div className="rs-canvas-host" ref={baseRef} />
              <div
                className="textLayer rs-book-text-layer"
                ref={textLayerHostRef}
                style={{
                  pointerEvents: turnState.active || toolMode === 'hand' ? 'none' : 'auto',
                }}
              />
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
