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
import { useSettings, FONT_FAMILIES } from '../../stores/settings';

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

function extractPlainText(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('[data-rs-repeated-header]').forEach((el) => el.remove());
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

function extractSnippet(html: string): string {
  return extractPlainText(html).slice(0, 48);
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
      className = '',
      isCode = false,
    },
    ref,
  ) {
    const font = useSettings((s) => s.font);
    const fontSize = useSettings((s) => s.fontSize);
    const lineHeight = useSettings((s) => s.lineHeight);
    const zen = useSettings((s) => s.zen);

    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const pageBoxRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);

    const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [measuredArticle, setMeasuredArticle] = useState<{ w: number; h: number } | null>(null);
    const [imgTick, setImgTick] = useState(0);
    const [fontsTick, setFontsTick] = useState(0);
    const imgDimsRef = useRef<Map<string, { w: number; h: number }>>(new Map());

    useEffect(() => {
      let alive = true;
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (alive) setFontsTick((t) => t + 1);
        });
      }
      return () => {
        alive = false;
      };
    }, []);

    // Responsive Book Sizing (authentic trade hardcover proportions ~1.30 aspect ratio)
    const aspect = 1.30;
    const availH = stageSize.h > 0 ? stageSize.h : 720;
    const availW = stageSize.w > 0 ? stageSize.w - 40 : 660;

    let fitBaseH = Math.max(380, Math.min(availH - 16, 840));
    let fitBaseW = Math.round(fitBaseH / aspect);
    if (fitBaseW > availW - 32) {
      fitBaseW = Math.max(260, availW - 32);
      fitBaseH = Math.round(fitBaseW * aspect);
    }

    const effectiveZoom = fit ? 1 : zoom;
    const bookW = Math.max(260, Math.round(fitBaseW * effectiveZoom));
    const bookH = Math.max(340, Math.round(fitBaseH * effectiveZoom));

    // Exact logical article dimensions (unaffected by optical zoom transform)
    const articleW = measuredArticle ? measuredArticle.w : Math.max(180, fitBaseW - 82);
    const articleH = measuredArticle ? measuredArticle.h : Math.max(220, fitBaseH - 112);

    // Preload image dimensions in rawHtml so paginator measures real image heights
    useEffect(() => {
      if (!rawHtml || !rawHtml.includes('<img')) return;
      let alive = true;
      const doc = new DOMParser().parseFromString(`<body>${rawHtml}</body>`, 'text/html');
      const imgs = Array.from(doc.querySelectorAll('img'));
      const pending: Promise<void>[] = [];

      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        if (!src || imgDimsRef.current.has(src)) continue;
        pending.push(
          new Promise<void>((resolve) => {
            const loader = new Image();
            const done = () => {
              if (loader.naturalWidth > 0 && loader.naturalHeight > 0) {
                imgDimsRef.current.set(src, {
                  w: loader.naturalWidth,
                  h: loader.naturalHeight,
                });
              }
              resolve();
            };
            loader.onload = done;
            loader.onerror = () => resolve();
            loader.src = src;
            setTimeout(resolve, 1500);
          }),
        );
      }

      if (pending.length > 0) {
        void Promise.all(pending).then(() => {
          if (alive) setImgTick((t) => t + 1);
        });
      }
      return () => {
        alive = false;
      };
    }, [rawHtml]);

    // Inject known aspect-ratio hints onto <img> tags before pagination
    const preparedHtml = useMemo(() => {
      if (!rawHtml) return rawHtml;
      if (!rawHtml.includes('<img') || imgDimsRef.current.size === 0) return rawHtml;
      const doc = new DOMParser().parseFromString(`<body>${rawHtml}</body>`, 'text/html');
      let changed = false;
      doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        const dims = imgDimsRef.current.get(src);
        if (dims && !img.getAttribute('width') && !img.getAttribute('height')) {
          img.style.aspectRatio = `${dims.w} / ${dims.h}`;
          if (!img.style.width) img.style.width = `${Math.min(dims.w, articleW)}px`;
          changed = true;
        }
      });
      return changed ? doc.body.innerHTML : rawHtml;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawHtml, imgTick, articleW]);

    const articleClass = `reader ${isCode ? 'text-body' : className || 'md-body'} rs-html-page-article`;
    const isLayoutReady = stageSize.w > 0 && measuredArticle !== null;

    // Dynamically paginate preparedHtml or rawText once real container dimensions are measured
    const pages = useMemo(() => {
      if (!isLayoutReady && (preparedHtml || rawText)) {
        return [''];
      }
      if (preparedHtml) {
        return paginateHtml(preparedHtml, {
          contentWidth: articleW,
          maxContentHeight: articleH,
          safetyBuffer: 10,
          fontSize: `${fontSize}px`,
          lineHeight: String(lineHeight),
          fontFamily: FONT_FAMILIES[font],
          articleClassName: articleClass,
        });
      }
      if (rawText) {
        const approxLineH = Math.max(18, Math.round(fontSize * lineHeight));
        return paginatePlainText(rawText, {
          maxLinesPerPage: Math.max(10, Math.floor((articleH - 16) / approxLineH)),
        });
      }
      return pagesProp || [''];
    }, [
      isLayoutReady,
      preparedHtml,
      rawText,
      pagesProp,
      articleW,
      articleH,
      font,
      fontSize,
      lineHeight,
      articleClass,
      fontsTick,
    ]);

    const totalPages = Math.max(1, pages.length);
    const safePage = Math.max(1, Math.min(totalPages, page));

    // Preserve reading position across re-pagination (settings / resize / Zen / image load)
    const prevDocNameRef = useRef(docName);
    const hasPaginatedOnceRef = useRef(false);
    const prevPagesRef = useRef<string[]>(pages);
    const anchorRef = useRef<{ snippet: string; ratio: number }>({ snippet: '', ratio: 0 });

    useEffect(() => {
      if (prevDocNameRef.current !== docName) {
        prevDocNameRef.current = docName;
        hasPaginatedOnceRef.current = false;
      }
      if (!isLayoutReady) return;

      if (!hasPaginatedOnceRef.current) {
        hasPaginatedOnceRef.current = true;
        prevPagesRef.current = pages;
        anchorRef.current = {
          snippet: extractSnippet(pages[safePage - 1] || ''),
          ratio: totalPages > 1 ? (safePage - 1) / (totalPages - 1) : 0,
        };
        return;
      }

      if (prevPagesRef.current !== pages) {
        const { snippet, ratio } = anchorRef.current;
        prevPagesRef.current = pages;
        if (snippet && snippet.length >= 8) {
          const needle = snippet.slice(0, 28);
          const expectedIdx = Math.round(ratio * Math.max(0, pages.length - 1));
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < pages.length; i++) {
            if (extractPlainText(pages[i]).includes(needle)) {
              const dist = Math.abs(i - expectedIdx);
              if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
              }
            }
          }
          if (bestIdx >= 0) {
            const target = bestIdx + 1;
            if (target !== safePage) setPage(target);
            return;
          }
        }
        const fallbackTarget = Math.max(
          1,
          Math.min(pages.length, Math.round(ratio * Math.max(0, pages.length - 1)) + 1),
        );
        if (fallbackTarget !== safePage) setPage(fallbackTarget);
      }
    }, [isLayoutReady, pages, docName, safePage, totalPages, setPage]);

    useEffect(() => {
      if (!isLayoutReady || !hasPaginatedOnceRef.current) return;
      anchorRef.current = {
        snippet: extractSnippet(pages[safePage - 1] || ''),
        ratio: totalPages > 1 ? (safePage - 1) / (totalPages - 1) : 0,
      };
    }, [isLayoutReady, safePage, totalPages, pages]);

    useEffect(() => {
      if (!isLayoutReady) return;
      onTotalPagesChange?.(totalPages);
    }, [isLayoutReady, totalPages, onTotalPagesChange]);

    useEffect(() => {
      if (isLayoutReady && page > totalPages) {
        setPage(totalPages);
      }
    }, [isLayoutReady, page, totalPages, setPage]);

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
    const turnTimerRef = useRef<number | null>(null);

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
    }, [zen]);

    // Measure exact logical article box inside .rs-html-book-page (immune to scrollbar width)
    useEffect(() => {
      const box = pageBoxRef.current;
      if (!box || stageSize.w <= 0) return;
      const measure = () => {
        const cs = window.getComputedStyle(box);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

        let headerH = 0;
        if (headerRef.current) {
          const hcs = window.getComputedStyle(headerRef.current);
          headerH =
            headerRef.current.offsetHeight +
            (parseFloat(hcs.marginTop) || 0) +
            (parseFloat(hcs.marginBottom) || 0);
        }
        let footerH = 0;
        if (footerRef.current) {
          const fcs = window.getComputedStyle(footerRef.current);
          footerH =
            footerRef.current.offsetHeight +
            (parseFloat(fcs.marginTop) || 0) +
            (parseFloat(fcs.marginBottom) || 0);
        }

        const w = Math.max(180, Math.floor(box.clientWidth - padX));
        const h = Math.max(200, Math.floor(box.clientHeight - padY - headerH - footerH));
        setMeasuredArticle((prev) =>
          !prev || Math.abs(prev.w - w) >= 2 || Math.abs(prev.h - h) >= 2 ? { w, h } : prev,
        );
      };
      const ro = new ResizeObserver(measure);
      ro.observe(box);
      measure();
      return () => ro.disconnect();
    }, [stageSize.w, fitBaseW, fitBaseH]);

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

      turnTimerRef.current = window.setTimeout(() => {
        setPage(to);
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

      turnTimerRef.current = window.setTimeout(() => {
        setPage(to);
        setTurnState({ active: false, dir: 'prev', fromPage: to, toPage: to });
        isTurningRef.current = false;
      }, 580);
    }, [safePage, setPage]);

    // Expose turn handles to parent via ref
    useImperativeHandle(ref, () => ({
      turnForward,
      turnBackward,
    }));

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
        } else if (e.key === 'Home' && !turnState.active) {
          e.preventDefault();
          setPage(1);
        } else if (e.key === 'End' && !turnState.active) {
          e.preventDefault();
          setPage(totalPages);
        }
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [turnForward, turnBackward, turnState.active, setPage, totalPages]);

    // Dynamic Stack Thickness to show reading progress
    const leftStackWidth = Math.min(14, Math.max(3, Math.round((safePage / totalPages) * 12)));
    const rightStackWidth = Math.min(
      14,
      Math.max(3, Math.round(((totalPages - safePage) / totalPages) * 12)),
    );

    // Drag Scrolling (Pan) controller & Touch Swipe Gesture
    const isDraggingScroll = useRef(false);
    const dragScrollStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
    const [isGrabbing, setIsGrabbing] = useState(false);
    const touchSwipeRef = useRef<{ x: number; y: number; time: number } | null>(null);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button, input, .rs-corner-hint, .rs-web-curl-controls'))
        return;

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
        if (dx < 0 && safePage < totalPages) {
          void turnForward();
        } else if (dx > 0 && safePage > 1) {
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

    // Get HTML content for layers
    const currentPageHtml = pages[safePage - 1] || '';
    const nextPageHtml = pages[safePage] || '';
    const prevPageHtml = pages[safePage - 2] || '';

    const baseHtml = turnState.active
      ? turnState.dir === 'next'
        ? nextPageHtml
        : currentPageHtml
      : currentPageHtml;

    const basePageNum = turnState.active
      ? turnState.dir === 'next'
        ? turnState.toPage
        : safePage
      : safePage;

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
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="rs-book-wrapper"
            style={{
              width: `${bookW}px`,
              height: `${bookH}px`,
            }}
          >
            <div
              className="rs-book-zoom-frame"
              style={{
                width: `${fitBaseW}px`,
                height: `${fitBaseH}px`,
                transform: effectiveZoom !== 1 ? `scale(${effectiveZoom})` : undefined,
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
                    ref={pageBoxRef}
                    className={`rs-html-book-page ${className}`}
                    style={{
                      userSelect: toolMode === 'hand' || turnState.active ? 'none' : 'text',
                      pointerEvents: turnState.active ? 'none' : 'auto',
                    }}
                  >
                    <div className="rs-book-header-line" ref={headerRef}>
                      <span className="rs-book-running-title" title={docName}>
                        {docName}
                      </span>
                      <span className="rs-book-running-page">Page {basePageNum}</span>
                    </div>

                    <article
                      className={articleClass}
                      dangerouslySetInnerHTML={{ __html: baseHtml }}
                    />

                    <div className="rs-book-footer-line" ref={footerRef}>
                      <span>— Page {basePageNum} of {totalPages} —</span>
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
                          className={articleClass}
                          dangerouslySetInnerHTML={{ __html: leafFrontHtml }}
                        />
                        <div className="rs-book-footer-line">
                          <span>
                            — Page {turnState.dir === 'next' ? safePage : safePage - 1} of {totalPages} —
                          </span>
                        </div>
                      </div>
                      <div className="rs-curl-lighting" />
                    </div>

                    <div className="rs-leaf-back">
                      <div className={`rs-html-book-page verso ${className}`}>
                        <article
                          className={articleClass}
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
