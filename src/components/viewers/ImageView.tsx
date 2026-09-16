import React, { useEffect, useState } from 'react';

/** Image viewer (FR-29). */
export default function ImageView({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const [url, setUrl] = useState('');
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const u = URL.createObjectURL(new Blob([buffer], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [buffer, name]);

  if (!url) return null;
  return (
    <div className="image-view" onClick={() => setZoomed((z) => !z)} title="Click to toggle zoom">
      <img src={url} alt={name} className={zoomed ? 'zoomed' : ''} draggable={false} />
    </div>
  );
}
