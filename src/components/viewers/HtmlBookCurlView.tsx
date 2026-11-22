import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { paginateHtml, paginatePlainText } from '../../services/htmlPaginator';

export interface HtmlBookCurlHandle {
  turnForward: () => Promise<void>;
  turnBackward: () => Promise<void>;
}

interface HtmlBookCurlViewProps {
  pages?: string[];
  rawHtml?: string;
  rawText?: string;
  page: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  onTotalPagesChange?: (total: number) => void;
  zoom?: number;
  fit?: boolean;
  docName: string;
  toolMode?: 'select' | 'hand';
  setToolMode?: (mode: 'select' | 'hand') => void;
  className?: string;
  isCode?: boolean;
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

export const HtmlBookCurlView = forwardRef<HtmlBookCurlHandle, HtmlBookCurlViewProps>(
  function HtmlBookCurlView(
    {
      pages: pagesProp,
      rawHtml,
      rawText,
      page,
      setPage,
      onTotalPagesChange,
      zoom = 1,
      fit = true,
      docName,
      toolMode = 'select',
      setToolMode,
      className = '',
      isCode = false,
    },
    ref,
  ) {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

    // Responsive Book Sizing (authentic trade hardcover proportions ~1.30 aspect ratio)
    const aspect = 1.30;
    const availH = stageSize.h > 0 ? stageSize.h : 720;
    const availW = stageSize.w > 0 ? stageSize.w - 40 : 660;

    let fitBaseH = Math.max(520, Math.min(availH - 16, 840));
    let fitBaseW = Math.round(fitBaseH / aspect);
    if (fitBaseW > availW - 32) {
      fitBaseW = availW - 32;
      fitBaseH = Math.round(fitBaseW * aspect);
    }

    const bookW = Math.max(340, Math.round(fit ? fitBaseW : fitBaseW * zoom));
    const bookH = Math.max(460, Math.round(fit ? fitBaseH : fitBaseH * zoom));

    const articleW = Math.max(260, fitBaseW - 82);
    const articleH = Math.max(320, fitBaseH - 84);

    // Dynamically paginate rawHtml or rawText to exact visual container dimensions
    const pages = useMemo(() => {
      if (rawHtml) {
        return paginateHtml(rawHtml, {
          contentWidth: articleW,
          maxContentHeight: articleH,
          safetyBuffer: 32,
        });
      }
      if (rawText) {
        return paginatePlainText(rawText, {
          maxLinesPerPage: Math.max(16, Math.floor((articleH - 32) / 26)),
        });
      }
      return pagesProp || [''];
    }, [rawHtml, rawText, pagesProp, articleW, articleH]);

    const totalPages = Math.max(1, pages.length);
    const safePage = Math.max(1, Math.min(totalPages, page));

    useEffect(() => {
      onTotalPagesChange?.(totalPages);
    }, [totalPages, onTotalPagesChange]);

    useEffect(() => {
      if (page > totalPages) {
        setPage(totalPages);
      }
    }, [page, totalPages, setPage]);

    const [turnState, setTurnState] = useState<{
      active: boolean;
      dir: 'next' | 'prev';
      fromPage: number;
      toPage: number;
    }>({
      active: false,
      dir: 'next',
      fromPage: safePage,
      toPage: safePage,
    });

    const isTurningRef = useRef(false);
    const prevPageRef = useRef(safePage);

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

    // When returning to Fit, gently reset scroll to top
    useEffect(() => {
      if (fit && scrollAreaRef.current) {
        scrollAreaRef.current.scrollTo({ top: 0, left: 0 });
      }
    }, [fit]);

    // Execute 3D Page Turn Forward (Page N -> N+1)
    const turnForward = useCallback(async () => {
      if (safePage >= totalPages || isTurningRef.current) return;
      isTurningRef.current = true;

      const from = safePage;
      const to = safePage + 1;

      playPaperTurnSound();
      setTurnState({ active: true, dir: 'next', fromPage: from, toPage: to });

      setTimeout(() => {
        setPage(to);
        prevPageRef.current = to;
        setTurnState({ active: false, dir: 'next', fromPage: to, toPage: to });
        isTurningRef.current = false;
      }, 580);
    }, [safePage, totalPages, setPage]);

    // Execute 3D Page Turn Backward (Page N -> N-1)
    const turnBackward = useCallback(async () => {
      if (safePage <= 1 || isTurningRef.current) return;
      isTurningRef.current = true;

      const from = safePage;
      const to = safePage - 1;

      playPaperTurnSound();
      setTurnState({ active: true, dir: 'prev', fromPage: from, toPage: to });

      setTimeout(() => {
        setPage(to);
        prevPageRef.current = to;
        setTurnState({ active: false, dir: 'prev', fromPage: to, toPage: to });
        isTurningRef.current = false;
      }, 580);
    }, [safePage, setPage]);

    // Expose turn handles to parent via ref
    useImperativeHandle(ref, () => ({
      turnForward,
      turnBackward,
    }));

    // Synchronize external page changes (e.g. from top toolbar or slider)
    useEffect(() => {
      if (safePage === prevPageRef.current) return;
      const oldP = prevPageRef.current;
      prevPageRef.current = safePage;

      if (safePage === oldP + 1 && !isTurningRef.current) {
        void turnForward();
      } else if (safePage === oldP - 1 && !isTurningRef.current) {
        void turnBackward();
      }
    }, [safePage, turnForward, turnBackward]);

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

    // Dynamic Stack Thickness to show reading progress
    const leftStackWidth = Math.min(14, Math.max(3, Math.round((safePage / totalPages) * 12)));
    const rightStackWidth = Math.min(
      14,
      Math.max(3, Math.round(((totalPages - safePage) / totalPages) * 12)),
    );

    // Drag Scrolling (Pan) controller & Horizontal Swipe Gesture
    const isDraggingScroll = useRef(false);
    const dragScrollStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
    const [isGrabbing, setIsGrabbing] = useState(false);
    const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button, input, .rs-corner-hint, .rs-web-curl-controls'))
        return;

      swipeStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };

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

    const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDraggingScroll.current) {
        isDraggingScroll.current = false;
        setIsGrabbing(false);
      }

      if (swipeStartRef.current) {
        const dx = e.clientX - swipeStartRef.current.x;
        const dy = Math.abs(e.clientY - swipeStartRef.current.y);
        const elapsed = Date.now() - swipeStartRef.current.time;

        // Horizontal swipe to turn page
        if (Math.abs(dx) > 50 && dy < 120 && elapsed < 800 && !turnState.active) {
          if (dx < 0 && safePage < totalPages) {
            void turnForward();
          } else if (dx > 0 && safePage > 1) {
            void turnBackward();
          }
        }
        swipeStartRef.current = null;
      }
    };

    useEffect(() => {
      const onUp = () => {
        isDraggingScroll.current = false;
        setIsGrabbing(false);
        swipeStartRef.current = null;
      };
      window.addEventListener('mouseup', onUp);
      return () => window.removeEventListener('mouseup', onUp);
    }, []);

    // Get HTML content for layers
    const currentPageHtml = pages[safePage - 1] || '';
    const nextPageHtml = pages[safePage] || '';
    const prevPageHtml = pages[safePage - 2] || '';

    const baseHtml = turnState.active
      ? turnState.dir === 'next'
        ? nextPageHtml
        : currentPageHtml
      : currentPageHtml;

    const leafFrontHtml = turnState.active
      ? turnState.dir === 'next'
        ? currentPageHtml
        : prevPageHtml
      : '';

    const leafBackHtml = leafFrontHtml;

    return (
      <div className="rs-book-stage">
        {/* Pinned Side Page Turn Buttons */}
        <button
          type="button"
          className="rs-book-side-btn left"
          disabled={safePage <= 1 || turnState.active}
          onClick={() => void turnBackward()}
          title="Previous page (ArrowLeft)"
          aria-label="Previous page"
        >
          ‹
        </button>

        <button
          type="button"
          className="rs-book-side-btn right"
          disabled={safePage >= totalPages || turnState.active}
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
              title={`${safePage - 1} pages read`}
            />

            {/* 3D Book Container */}
            <div className="rs-book-container">
              {/* Running Spine Crease Shadow */}
              <div className="rs-book-spine" />

              {/* Underneath Base Layer with Native Selectable Text */}
              <div className="rs-page-base">
                <div
                  className={`rs-html-book-page ${className}`}
                  style={{
                    userSelect: toolMode === 'hand' || turnState.active ? 'none' : 'text',
                    pointerEvents: toolMode === 'hand' || turnState.active ? 'none' : 'auto',
                  }}
                >
                  <div className="rs-book-header-line">
                    <span className="rs-book-running-title" title={docName}>
                      {docName}
                    </span>
                    <span className="rs-book-running-page">Page {safePage}</span>
                  </div>

                  <article
                    className={`reader ${isCode ? 'text-body' : 'md-body'} rs-html-page-article`}
                    dangerouslySetInnerHTML={{ __html: baseHtml }}
                  />

                  <div className="rs-book-footer-line">
                    <span>— Page {safePage} of {totalPages} —</span>
                  </div>
                </div>

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
                    <div className={`rs-html-book-page ${className}`}>
                      <div className="rs-book-header-line">
                        <span className="rs-book-running-title" title={docName}>
                          {docName}
                        </span>
                        <span className="rs-book-running-page">
                          Page {turnState.dir === 'next' ? safePage : safePage - 1}
                        </span>
                      </div>
                      <article
                        className={`reader ${isCode ? 'text-body' : 'md-body'} rs-html-page-article`}
                        dangerouslySetInnerHTML={{ __html: leafFrontHtml }}
                      />
                      <div className="rs-book-footer-line">
                        <span>— Page {turnState.dir === 'next' ? safePage : safePage - 1} of {totalPages} —</span>
                      </div>
                    </div>
                    <div className="rs-curl-lighting" />
                  </div>

                  <div className="rs-leaf-back">
                    <div className={`rs-html-book-page verso ${className}`}>
                      <article
                        className={`reader ${isCode ? 'text-body' : 'md-body'} rs-html-page-article`}
                        dangerouslySetInnerHTML={{ __html: leafBackHtml }}
                      />
                    </div>
                    <div className="rs-curl-lighting-back" />
                  </div>
                </div>
              )}

              {/* Interactive Tap / Click Zones for Fast Turning */}
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

              {/* Corner Peel Hover Hint (Play Books Dog-Ear) */}
              {safePage < totalPages && !turnState.active && (
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
              title={`${totalPages - safePage} pages remaining`}
            />
          </div>
        </div>

        {/* Bottom Floating Bar with Smooth Page Scrubber & Counter */}
        <div className="rs-web-curl-controls">
          <button
            type="button"
            className="btn btn-ghost rs-curl-btn"
            disabled={safePage <= 1 || turnState.active}
            onClick={() => void turnBackward()}
            title="Previous page (ArrowLeft)"
          >
            ‹ Prev
          </button>

          <div className="rs-curl-slider-box">
            <span className="pdf-pageinfo">
              Page {safePage} of {totalPages}
            </span>
            <input
              type="range"
              min={1}
              max={totalPages}
              value={safePage}
              disabled={turnState.active}
              onChange={(e) => setPage(Number(e.target.value))}
              className="rs-curl-slider"
              title={`Slide to jump through ${totalPages} pages`}
            />
          </div>

          <button
            type="button"
            className="btn btn-ghost rs-curl-btn"
            disabled={safePage >= totalPages || turnState.active}
            onClick={() => void turnForward()}
            title="Next page (ArrowRight)"
          >
            Next ›
          </button>
        </div>
      </div>
    );
  },
);
