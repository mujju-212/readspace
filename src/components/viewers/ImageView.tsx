import React, { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Image viewer with interactive zoom, wheel scaling, pan, and toolbar controls.
 */
export default function ImageView({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const [url, setUrl] = useState('');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const u = URL.createObjectURL(new Blob([buffer], { type: mime }));
    setUrl(u);
    setScale(1);
    setPan({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(u);
  }, [buffer, name]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setScale((prev) => Math.min(8, Math.max(0.2, prev * factor)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (scale !== 1) {
      setScale(1);
      setPan({ x: 0, y: 0 });
    } else {
      setScale(2);
    }
  }, [scale]);

  const zoomIn = () => setScale((s) => Math.min(8, s * 1.25));
  const zoomOut = () => setScale((s) => Math.max(0.2, s * 0.8));
  const resetZoom = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const fitWidth = () => {
    setScale(1.75);
    setPan({ x: 0, y: 0 });
  };

  if (!url) return null;

  return (
    <div
      ref={containerRef}
      className="image-view"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      style={{
        cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default',
        position: 'relative',
        userSelect: 'none',
      }}
      title="Scroll or double-click to zoom; drag to pan"
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          transition: isDragging ? 'none' : 'transform 0.12s ease-out',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <img
          src={url}
          alt={name}
          draggable={false}
          style={{
            maxWidth: '90%',
            maxHeight: '90%',
            objectFit: 'contain',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
            borderRadius: '4px',
          }}
        />
      </div>

      {/* Floating Zoom Toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 24,
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          zIndex: 10,
          color: '#f8fafc',
          fontSize: 13,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={zoomOut}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            color: '#fff',
            borderRadius: '50%',
            width: 28,
            height: 28,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: '28px',
            textAlign: 'center',
            padding: 0,
          }}
          title="Zoom out"
        >
          −
        </button>

        <span style={{ minWidth: 46, textAlign: 'center', fontWeight: 600 }}>
          {Math.round(scale * 100)}%
        </span>

        <button
          type="button"
          onClick={zoomIn}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            color: '#fff',
            borderRadius: '50%',
            width: 28,
            height: 28,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: '28px',
            textAlign: 'center',
            padding: 0,
          }}
          title="Zoom in"
        >
          +
        </button>

        <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.2)' }} />

        <button
          type="button"
          onClick={resetZoom}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
          title="Reset to original size"
        >
          100%
        </button>

        <button
          type="button"
          onClick={fitWidth}
          style={{
            background: 'none',
            border: 'none',
            color: '#60a5fa',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
          title="Fit width for documents/screenshots"
        >
          Fit Width
        </button>
      </div>
    </div>
  );
}
