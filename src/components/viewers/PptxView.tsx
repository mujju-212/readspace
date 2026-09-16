import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';

interface SlideParagraph {
  text: string;
  level: number;
  bold: boolean;
  isTitle: boolean;
}

interface SlideData {
  id: number;
  title: string;
  paragraphs: SlideParagraph[];
  images: string[]; // Base64 or object URLs
  notes: string;
}

function extractLegacyPptStrings(buffer: ArrayBuffer): string[] {
  // Extract printable text chunks from legacy OLE .ppt binary
  const bytes = new Uint8Array(buffer);
  const strings: string[] = [];
  let current = '';

  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    // Printable ASCII or newline/tab
    if ((code >= 32 && code <= 126) || code === 10 || code === 13) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length >= 5) {
        strings.push(current.trim());
      }
      current = '';
    }
  }
  if (current.trim().length >= 5) strings.push(current.trim());
  return strings;
}

export default function PptxView({
  buffer,
  name,
}: {
  buffer: ArrayBuffer;
  name: string;
}) {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [showNotes, setShowNotes] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse PPTX archive using JSZip
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles: { name: string; num: number }[] = [];

        // Match slide XML files: ppt/slides/slide{N}.xml
        zip.forEach((relativePath) => {
          const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
          if (match) {
            slideFiles.push({ name: relativePath, num: parseInt(match[1], 10) });
          }
        });

        // Sort slides by number
        slideFiles.sort((a, b) => a.num - b.num);

        if (slideFiles.length === 0) {
          throw new Error('No slide files found in PPTX package');
        }

        const parser = new DOMParser();
        const parsedSlides: SlideData[] = [];

        for (const fileInfo of slideFiles) {
          const slideXmlStr = await zip.file(fileInfo.name)!.async('string');
          const slideDoc = parser.parseFromString(slideXmlStr, 'application/xml');

          // 1. Relationships for images: ppt/slides/_rels/slide{N}.xml.rels
          const relsPath = `ppt/slides/_rels/slide${fileInfo.num}.xml.rels`;
          const relsFile = zip.file(relsPath);
          const relsMap = new Map<string, string>();

          if (relsFile) {
            const relsXml = await relsFile.async('string');
            const relsDoc = parser.parseFromString(relsXml, 'application/xml');
            const relElements = relsDoc.getElementsByTagName('Relationship');
            for (let i = 0; i < relElements.length; i++) {
              const r = relElements[i];
              const rId = r.getAttribute('Id');
              const target = r.getAttribute('Target');
              if (rId && target) {
                // target can be "../media/image1.png" -> "ppt/media/image1.png"
                const normalized = target.replace(/^\.\.\//, 'ppt/');
                relsMap.set(rId, normalized);
              }
            }
          }

          // 2. Extract images embedded in this slide
          const images: string[] = [];
          const blipElements = slideDoc.getElementsByTagName('a:blip');
          for (let i = 0; i < blipElements.length; i++) {
            const embedId = blipElements[i].getAttribute('r:embed');
            if (embedId && relsMap.has(embedId)) {
              const imagePath = relsMap.get(embedId)!;
              const imgZipFile = zip.file(imagePath);
              if (imgZipFile) {
                const base64 = await imgZipFile.async('base64');
                const ext = imagePath.split('.').pop()?.toLowerCase() || 'png';
                const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
                images.push(`data:${mime};base64,${base64}`);
              }
            }
          }

          // 3. Extract Slide Text & Hierarchy
          let slideTitle = '';
          const paragraphs: SlideParagraph[] = [];
          const spElements = slideDoc.getElementsByTagName('p:sp');

          for (let i = 0; i < spElements.length; i++) {
            const sp = spElements[i];
            // Check if shape is a title placeholder
            const ph = sp.getElementsByTagName('p:ph')[0];
            const phType = ph ? ph.getAttribute('type') : null;
            const isTitleShape = phType === 'title' || phType === 'ctrTitle';

            const pElements = sp.getElementsByTagName('a:p');
            for (let j = 0; j < pElements.length; j++) {
              const p = pElements[j];
              const pPr = p.getElementsByTagName('a:pPr')[0];
              const level = pPr && pPr.getAttribute('lvl') ? parseInt(pPr.getAttribute('lvl')!, 10) : 0;

              // Accumulate text from runs
              let pText = '';
              let isBold = false;
              const rElements = p.getElementsByTagName('a:r');
              for (let k = 0; k < rElements.length; k++) {
                const r = rElements[k];
                const t = r.getElementsByTagName('a:t')[0];
                if (t && t.textContent) {
                  pText += t.textContent;
                }
                const rPr = r.getElementsByTagName('a:rPr')[0];
                if (rPr && rPr.getAttribute('b') === '1') {
                  isBold = true;
                }
              }

              const trimmed = pText.trim();
              if (trimmed) {
                if (isTitleShape && !slideTitle) {
                  slideTitle = trimmed;
                } else {
                  paragraphs.push({
                    text: trimmed,
                    level,
                    bold: isBold,
                    isTitle: isTitleShape,
                  });
                }
              }
            }
          }

          if (!slideTitle && paragraphs.length > 0) {
            slideTitle = paragraphs[0].text;
            paragraphs.shift();
          }

          // 4. Notes if available
          let notes = '';
          const notesPath = `ppt/notesSlides/notesSlide${fileInfo.num}.xml`;
          const notesFile = zip.file(notesPath);
          if (notesFile) {
            const notesXml = await notesFile.async('string');
            const notesDoc = parser.parseFromString(notesXml, 'application/xml');
            const notesT = notesDoc.getElementsByTagName('a:t');
            const notesLines: string[] = [];
            for (let i = 0; i < notesT.length; i++) {
              if (notesT[i].textContent) notesLines.push(notesT[i].textContent!);
            }
            notes = notesLines.join(' ').trim();
          }

          parsedSlides.push({
            id: fileInfo.num,
            title: slideTitle || `Slide ${parsedSlides.length + 1}`,
            paragraphs,
            images,
            notes,
          });
        }

        if (alive) {
          setSlides(parsedSlides);
          setCurrentSlideIndex(0);
          setLoading(false);
        }
      } catch (err) {
        // Fallback for legacy .ppt format or corrupt file
        try {
          const strings = extractLegacyPptStrings(buffer);
          if (strings.length > 0 && alive) {
            const fallbackSlide: SlideData = {
              id: 1,
              title: name,
              paragraphs: strings.slice(0, 50).map((t) => ({
                text: t,
                level: 0,
                bold: false,
                isTitle: false,
              })),
              images: [],
              notes: 'Extracted raw textual content from legacy presentation format.',
            };
            setSlides([fallbackSlide]);
            setLoading(false);
            return;
          }
        } catch {
          /* fallback failed */
        }

        if (alive) {
          setError(
            err instanceof Error ? err.message : 'Unable to parse presentation archive (.pptx)'
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [buffer, name]);

  // Navigation handlers
  const prevSlide = useCallback(() => {
    setCurrentSlideIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const nextSlide = useCallback(() => {
    setCurrentSlideIndex((idx) => Math.min(slides.length - 1, idx + 1));
  }, [slides.length]);

  const togglePresentation = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try {
        await el.requestFullscreen();
        setIsPresentationMode(true);
      } catch {
        /* fullscreen denied */
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsPresentationMode(false);
      } catch {
        /* exit error */
      }
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevSlide();
      } else if (e.key === 'F5') {
        e.preventDefault();
        void togglePresentation();
      } else if (e.key === 'Escape' && isPresentationMode) {
        setIsPresentationMode(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [nextSlide, prevSlide, togglePresentation, isPresentationMode]);

  if (loading) {
    return (
      <div className="pptx-loading-box">
        <div className="spinner-ring" />
        <p>Loading and rendering presentation slides…</p>
      </div>
    );
  }

  if (error || slides.length === 0) {
    return (
      <div className="pptx-error-box">
        <span style={{ fontSize: 36 }}>📊</span>
        <h3>Could not preview presentation</h3>
        <p className="muted small">{error || 'No slides could be extracted.'}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            const blob = new Blob([buffer]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download File
        </button>
      </div>
    );
  }

  const activeSlide = slides[currentSlideIndex] || slides[0];

  return (
    <div
      ref={containerRef}
      className={`pptx-viewer-wrap ${isPresentationMode ? 'presentation-mode' : ''}`}
    >
      {/* Top Toolbar */}
      <div className="pptx-toolbar">
        <div className="pptx-toolbar-left">
          <button
            type="button"
            className={`btn btn-sm ${showThumbnails ? 'btn-active' : 'btn-ghost'}`}
            onClick={() => setShowThumbnails(!showThumbnails)}
            title="Toggle slide thumbnails list"
          >
            📑 Slides ({slides.length})
          </button>
          <div className="pptx-slide-counter">
            Slide {currentSlideIndex + 1} of {slides.length}
          </div>
        </div>

        <div className="pptx-toolbar-center">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={prevSlide}
            disabled={currentSlideIndex === 0}
            title="Previous slide (←)"
          >
            ◀ Prev
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={nextSlide}
            disabled={currentSlideIndex === slides.length - 1}
            title="Next slide (→ / Space)"
          >
            Next ▶
          </button>
        </div>

        <div className="pptx-toolbar-right">
          {activeSlide.notes && (
            <button
              type="button"
              className={`btn btn-sm ${showNotes ? 'btn-active' : 'btn-ghost'}`}
              onClick={() => setShowNotes(!showNotes)}
              title="Toggle speaker notes"
            >
              📝 Notes
            </button>
          )}

          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={togglePresentation}
            title="Start presentation slideshow (F5)"
          >
            ⤢ Present
          </button>
        </div>
      </div>

      <div className="pptx-main-body">
        {/* Left Thumbnails Strip */}
        {showThumbnails && !isPresentationMode && (
          <aside className="pptx-thumbnails-strip" aria-label="Slide thumbnails">
            {slides.map((s, idx) => (
              <div
                key={s.id}
                className={`pptx-thumb-card ${idx === currentSlideIndex ? 'active' : ''}`}
                onClick={() => setCurrentSlideIndex(idx)}
              >
                <div className="pptx-thumb-num">{idx + 1}</div>
                <div className="pptx-thumb-preview">
                  <div className="pptx-thumb-title">{s.title || `Slide ${idx + 1}`}</div>
                  {s.images.length > 0 && (
                    <div className="pptx-thumb-img-badge">📷 {s.images.length}</div>
                  )}
                </div>
              </div>
            ))}
          </aside>
        )}

        {/* Center Slide Canvas */}
        <div className="pptx-stage">
          <div className="pptx-slide-canvas">
            {/* Slide Header */}
            <header className="pptx-slide-header">
              <h1 className="pptx-slide-title">{activeSlide.title}</h1>
            </header>

            {/* Slide Content Body */}
            <div className="pptx-slide-content">
              {/* Bullet / Paragraph list */}
              {activeSlide.paragraphs.length > 0 && (
                <div className="pptx-slide-bullets">
                  {activeSlide.paragraphs.map((p, pIdx) => (
                    <div
                      key={pIdx}
                      className={`pptx-bullet-item level-${p.level} ${p.bold ? 'bold' : ''}`}
                      style={{ paddingLeft: `${p.level * 24}px` }}
                    >
                      <span className="pptx-bullet-dot">•</span>
                      <span className="pptx-bullet-text">{p.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Embedded Slide Images */}
              {activeSlide.images.length > 0 && (
                <div className={`pptx-slide-images count-${Math.min(activeSlide.images.length, 4)}`}>
                  {activeSlide.images.map((src, imgIdx) => (
                    <div key={imgIdx} className="pptx-image-box">
                      <img
                        src={src}
                        alt={`Slide ${currentSlideIndex + 1} media ${imgIdx + 1}`}
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}

              {activeSlide.paragraphs.length === 0 && activeSlide.images.length === 0 && (
                <div className="pptx-slide-empty">
                  <span>(Slide has no additional content)</span>
                </div>
              )}
            </div>

            {/* Slide Footer */}
            <footer className="pptx-slide-footer">
              <span className="pptx-footer-filename">{name}</span>
              <span className="pptx-footer-page">
                {currentSlideIndex + 1} / {slides.length}
              </span>
            </footer>
          </div>

          {/* Speaker Notes Drawer */}
          {showNotes && activeSlide.notes && (
            <div className="pptx-notes-panel">
              <div className="pptx-notes-header">
                <span>📝 Speaker Notes</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowNotes(false)}
                  title="Close notes"
                >
                  ✕
                </button>
              </div>
              <div className="pptx-notes-body">{activeSlide.notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
