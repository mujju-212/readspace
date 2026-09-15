/** Compact inline SVG icon set (no icon dependency). */
import React from 'react';

type P = { size?: number; className?: string };
const S = ({ size = 14, className, children }: P & { children: React.ReactNode }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ChevronRight = (p: P) => <S {...p}><path d="M6 3.5 10.5 8 6 12.5" /></S>;
export const ChevronDown = (p: P) => <S {...p}><path d="M3.5 6 8 10.5 12.5 6" /></S>;
export const Close = (p: P) => <S {...p}><path d="M4 4l8 8M12 4l-8 8" /></S>;
export const Folder = (p: P) => <S {...p}><path d="M1.5 4.5c0-.6.4-1 1-1H6l1.5 1.8h6c.6 0 1 .4 1 1v6.2c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z" /></S>;
export const FolderOpen = (p: P) => <S {...p}><path d="M1.5 4.5c0-.6.4-1 1-1H6l1.5 1.8h6c.6 0 1 .4 1 1v.7H3.4L1.5 12.7zm1.9 2.5h11.4l-1.6 5.4c-.1.4-.5.7-.9.7H1.5z" /></S>;
export const Book = (p: P) => <S {...p}><path d="M2 3.2C2 2.5 2.5 2 3.2 2H7c.9 0 1.6.7 1.6 1.6V14c0-.9-.7-1.6-1.6-1.6H3.2c-.7 0-1.2-.5-1.2-1.2zM14 3.2c0-.7-.5-1.2-1.2-1.2H9c-.9 0-1.6.7-1.6 1.6V14c0-.9.7-1.6 1.6-1.6h3.8c.7 0 1.2-.5 1.2-1.2z" /></S>;
export const Search = (p: P) => <S {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></S>;
export const Refresh = (p: P) => <S {...p}><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" /></S>;
export const Sun = (p: P) => <S {...p}><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13" /></S>;
export const Moon = (p: P) => <S {...p}><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" /></S>;
export const Leaf = (p: P) => <S {...p}><path d="M8 14c-3.3 0-6-2.7-6-6 4-4 12-4 12 0 0 3.3-2.7 6-6 6zM2 14c2-4 6-6 10-6.5" /></S>;
export const Gear = (p: P) => <S {...p}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5 8.8 3.4l2-.4 1 1.7 1.8 1-.8 1.9.8 1.9-1.8 1-1 1.7-2-.4L8 14.5 7.2 12.6l-2 .4-1-1.7-1.8-1 .8-1.9-.8-1.9 1.8-1 1-1.7 2 .4z" /></S>;
export const PanelLeft = (p: P) => <S {...p}><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2" /><path d="M6 2.5v11" /></S>;
export const Maximize = (p: P) => <S {...p}><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></S>;
export const Split = (p: P) => <S {...p}><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2" /><path d="M8 2.5v11" /></S>;
export const Eye = (p: P) => <S {...p}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></S>;
export const Pencil = (p: P) => <S {...p}><path d="m11.5 2 2.5 2.5L5.5 13 2 14l1-3.5zM9.5 4l2.5 2.5" /></S>;
export const Save = (p: P) => <S {...p}><path d="M2.5 2.5h9L13.5 5v8.5h-11zM5 2.5V6h5V2.5M5 13.5V9.5h6v4" /></S>;
export const Download = (p: P) => <S {...p}><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" /></S>;
export const Plus = (p: P) => <S {...p}><path d="M8 3v10M3 8h10" /></S>;
export const ZoomIn = (p: P) => <S {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5M7 5v4M5 7h4" /></S>;
export const ZoomOut = (p: P) => <S {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5M5 7h4" /></S>;
export const Wrap = (p: P) => <S {...p}><path d="M2 3.5h12M2 8h9.5a2.2 2.2 0 0 1 0 4.4H9M2 12.5h4M10.5 10.9 9 12.4l1.5 1.5" /></S>;
export const Cloud = (p: P) => <S {...p}><path d="M4.6 12.5a3.1 3.1 0 0 1-.4-6.2 4.3 4.3 0 0 1 8.4-.8 3.2 3.2 0 0 1-.6 6.4z" /><path d="M8 8.5v5M8 8.5 6.2 10.3M8 8.5l1.8 1.8" /></S>;
export const CloudUpload = (p: P) => (
  <S {...p}>
    <path d="M4.6 12.5a3.1 3.1 0 0 1-.4-6.2 4.3 4.3 0 0 1 8.4-.8 3.2 3.2 0 0 1-.6 6.4z" />
    <path d="M8 12.5V7M5.5 9.5 8 7l2.5 2.5" />
  </S>
);

/* ------- file-type icons (colored) ------- */

const FILE_COLORS: Record<string, string> = {
  markdown: '#4d8bf8',
  html: '#e5622e',
  text: '#98a0a8',
  pdf: '#e5534b',
  docx: '#3f7fd4',
  image: '#2ea86e',
  unknown: '#7a828a',
};

export function FileIcon({ rendererId, size = 14 }: { rendererId: string; size?: number }) {
  const color = FILE_COLORS[rendererId] ?? FILE_COLORS.unknown;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M3.5 1.5h6L13 5v9.5h-9.5z"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M9.5 1.5V5H13" stroke={color} strokeWidth="1.3" strokeLinejoin="round" fill="none" />
      {rendererId === 'markdown' && <path d="M5 10.5V8l1.5 1.7L8 8v2.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />}
      {rendererId === 'pdf' && <path d="M5.5 11V8.5h2M5.5 9.8H7.5M8.5 11V8.5M9.5 8.5c2 .3 2 2.2 0 2.5" stroke={color} strokeWidth="1" strokeLinecap="round" fill="none" />}
      {rendererId === 'docx' && <path d="M5.5 8.5 6.5 11l1-2.5 1 2.5 1-2.5" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
      {(rendererId === 'text' || rendererId === 'unknown') && <path d="M5.5 7.5h5M5.5 9.5h5M5.5 11.5h3" stroke={color} strokeWidth="1.1" strokeLinecap="round" />}
      {rendererId === 'image' && <><rect x="5" y="7" width="6" height="4.5" rx="0.6" stroke={color} strokeWidth="1" /><circle cx="6.8" cy="8.3" r="0.6" fill={color} /><path d="m5.5 11 1.8-1.8 1.2 1.2 1-1 1.5 1.6" stroke={color} strokeWidth="0.9" fill="none" /></>}
      {rendererId === 'html' && <path d="m6.2 8.2-1 1.3 1 1.3M9.8 8.2l1 1.3-1 1.3M8.4 7.8l-.8 3.4" stroke={color} strokeWidth="0.9" strokeLinecap="round" fill="none" />}
    </svg>
  );
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path
        d="M8 9.5C8 8.7 8.7 8 9.5 8H14c1.1 0 2 .9 2 2v14c0-1.1-.9-2-2-2H9.5c-.8 0-1.5-.7-1.5-1.5v-11zM24 9.5c0-.8-.7-1.5-1.5-1.5H18c-1.1 0-2 .9-2 2v14c0-1.1.9-2 2-2h4.5c.8 0 1.5-.7 1.5-1.5v-11z"
        fill="#fff"
      />
    </svg>
  );
}
