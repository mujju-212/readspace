/** Core file-system abstraction shared by every provider (TRD §3.2). */

export interface FileStat {
  size: number;
  modifiedTime?: string;
}

export interface FsEntry {
  name: string;
  /** workspace-relative path, '/' separated */
  path: string;
  kind: 'file' | 'directory';
  ext?: string;
  size?: number;
}

export interface FileSystemProvider {
  /** unique, stable id for this workspace (used for session persistence) */
  readonly id: string;
  readonly label: string;
  readonly kind: 'fsa' | 'fallback' | 'sample' | 'gdrive' | 'clouddrive' | 'cloudlink';
  readonly canWrite: boolean;
  listDir(path: string): Promise<FsEntry[]>;
  readFile(path: string): Promise<ArrayBuffer>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  stat?(path: string): Promise<FileStat>;
  getFileUrl?(path: string): Promise<string> | string | undefined;
}

export type RendererId = 'markdown' | 'text' | 'html' | 'pdf' | 'docx' | 'image' | 'audio' | 'video' | 'pptx' | 'unknown';

const RENDERER_FOR_EXT: Record<string, RendererId> = {
  // Documentation / Notes
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  txt: 'text',
  text: 'text',
  log: 'text',
  csv: 'text',
  tsv: 'text',

  // Web & Styles
  html: 'html',
  htm: 'html',
  xml: 'text',
  css: 'text',
  scss: 'text',
  sass: 'text',
  less: 'text',

  // JavaScript & TypeScript
  js: 'text',
  mjs: 'text',
  cjs: 'text',
  jsx: 'text',
  ts: 'text',
  tsx: 'text',

  // Python & Data Science
  py: 'text',
  pyw: 'text',
  r: 'text',

  // Systems & Compiled Languages
  c: 'text',
  h: 'text',
  cpp: 'text',
  hpp: 'text',
  cc: 'text',
  cxx: 'text',
  cs: 'text',
  java: 'text',
  go: 'text',
  rs: 'text',
  swift: 'text',
  kt: 'text',
  kts: 'text',
  dart: 'text',
  scala: 'text',

  // Web Backends & Scripting
  php: 'text',
  rb: 'text',
  lua: 'text',
  sh: 'text',
  bash: 'text',
  zsh: 'text',
  fish: 'text',
  ps1: 'text',
  psm1: 'text',
  bat: 'text',
  cmd: 'text',
  sql: 'text',

  // Config & Structured Formats
  json: 'text',
  jsonc: 'text',
  yml: 'text',
  yaml: 'text',
  toml: 'text',
  ini: 'text',
  conf: 'text',
  env: 'text',
  properties: 'text',
  dockerfile: 'text',
  gitignore: 'text',

  // Office & Rich Documents
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  ppt: 'pptx',

  // Images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',

  // Audio
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',

  // Video
  mp4: 'video',
  webm: 'video',
  ogv: 'video',
  mov: 'video',
  mkv: 'video',
};

/** Renderers that support the Preview / Edit toggle */
export const EDITABLE_RENDERERS = new Set<RendererId>(['markdown', 'text', 'html']);

export function rendererForExt(ext: string): RendererId {
  return RENDERER_FOR_EXT[ext.toLowerCase()] ?? 'unknown';
}

export function rendererLabel(id: RendererId): string {
  switch (id) {
    case 'markdown': return 'Markdown';
    case 'html': return 'HTML';
    case 'text': return 'Plain text';
    case 'pdf': return 'PDF';
    case 'docx': return 'Word document';
    case 'pptx': return 'Presentation';
    case 'image': return 'Image';
    case 'audio': return 'Audio';
    case 'video': return 'Video';
    default: return 'Unknown';
  }
}

/* ---------- path helpers ---------- */

export function extOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  if (i > 0) return base.slice(i + 1);
  if (i === 0) return base.slice(1);
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile') return 'makefile';
  return '';
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function sortEntries(entries: FsEntry[]): FsEntry[] {
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

/** Folders we never traverse (TRD §3.4) */
export const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build']);

export function isVisible(entry: FsEntry, showHidden: boolean): boolean {
  if (!showHidden && entry.name.startsWith('.')) return false;
  if (entry.kind === 'directory' && IGNORED_DIRS.has(entry.name)) return false;
  return true;
}
