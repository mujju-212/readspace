import type { FileSystemProvider, FsEntry } from './types';
import { basename, dirname, extOf, sortEntries } from './types';
import { addRecent, kvSet } from '../persistence';

/**
 * Google Drive provider (v0.2): paste a public file or folder link and read it
 * like a local workspace. Uses the Drive API v3 with a user-supplied API key
 * (browser CORS is supported by googleapis.com). Items must be shared as
 * "Anyone with the link can view". Read-only.
 */

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KEY_STORAGE = 'rs.gdrive.key';

export type GDriveKind = 'file' | 'folder' | 'gdoc' | 'gsheet' | 'gppt';

export function storedDriveKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; }
}
export function storeDriveKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* ignore */ }
}

export interface ParsedDriveLink { id: string; hint: GDriveKind; resourceKey?: string }

/** Extract a Drive ID (+ link-shared resourceKey) from the many link shapes Google uses. */
export function parseGDriveLink(raw: string): ParsedDriveLink | null {
  const s = raw.trim();
  if (!s) return null;
  const rk = s.match(/[?&]resourcekey=([^&]+)/i)?.[1];
  const resourceKey = rk ? decodeURIComponent(rk) : undefined;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{10,})/))) return { id: m[1], hint: 'folder' , resourceKey };
  if ((m = s.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/))) return { id: m[1], hint: 'file' , resourceKey };
  if ((m = s.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{10,})/))) return { id: m[1], hint: 'gdoc' , resourceKey };
  if ((m = s.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/))) return { id: m[1], hint: 'gsheet' , resourceKey };
  if ((m = s.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]{10,})/))) return { id: m[1], hint: 'gppt' , resourceKey };
  if ((m = s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/))) return { id: m[1], hint: 'file' , resourceKey };
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(s)) return { id: s, hint: 'file' , resourceKey };
  return null;
}

interface Meta { id: string; name: string; mimeType: string; size?: string }

async function apiJson<T>(path: string, key: string, params: Record<string, string> = {}, resourceKey?: string): Promise<T> {
  if (resourceKey) params = { ...params, resourceKey };
  const url = new URL(`${API}${path}`);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    let msg = `Google Drive error ${res.status}`;
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* keep default */ }
    if (res.status === 403) msg += ' — make sure the link is shared as “Anyone with the link can view”, the Drive API is enabled for your key, and the key has no HTTP-referrer restriction blocking this origin.';
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function downloadFile(id: string, key: string, mime: string, resourceKey?: string): Promise<ArrayBuffer> {
  const rks = resourceKey ? `&resourceKey=${encodeURIComponent(resourceKey)}` : '';
  let url: string;
  if (mime === 'application/vnd.google-apps.document') url = `${API}/files/${id}/export?mimeType=text%2Fplain&key=${encodeURIComponent(key)}${rks}`;
  else if (mime === 'application/vnd.google-apps.spreadsheet') url = `${API}/files/${id}/export?mimeType=text%2Fcsv&key=${encodeURIComponent(key)}${rks}`;
  else if (mime === 'application/vnd.google-apps.presentation') url = `${API}/files/${id}/export?mimeType=text%2Fplain&key=${encodeURIComponent(key)}${rks}`;
  else url = `${API}/files/${id}?alt=media&key=${encodeURIComponent(key)}${rks}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.arrayBuffer();
}

const MIME_TO_EXT: Record<string, string> = {
  'text/markdown': 'md', 'text/x-markdown': 'md',
  'application/pdf': 'pdf', 'text/html': 'html', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/json': 'json', 'application/xml': 'xml',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.google-apps.document': 'txt',
  'application/vnd.google-apps.spreadsheet': 'csv',
  'application/vnd.google-apps.presentation': 'txt',
};

export class GDriveProvider implements FileSystemProvider {
  readonly kind = 'gdrive' as const;
  readonly canWrite = false;
  readonly id: string;
  readonly label: string;

  private key: string;
  private resourceKey?: string;
  /** path -> Drive metadata ('' is the root) */
  private info = new Map<string, Meta>();
  private childrenByPath = new Map<string, FsEntry[]>();

  constructor(root: Meta, key: string, resourceKey?: string) {
    this.key = key;
    this.resourceKey = resourceKey;
    this.label = root.name || 'Google Drive';
    this.id = `gdrive:${root.id}`;
    this.info.set('', root);
  }

  private toEntry(m: Meta, parentPath: string): FsEntry {
    const path = parentPath ? `${parentPath}/${m.name}` : m.name;
    this.info.set(path, m);
    const isFolder = m.mimeType === FOLDER_MIME;
    return {
      name: m.name,
      path,
      kind: isFolder ? 'directory' : 'file',
      ext: isFolder ? undefined : (extOf(m.name) || MIME_TO_EXT[m.mimeType]),
      size: m.size ? Number(m.size) : undefined,
    };
  }

  async listDir(path: string): Promise<FsEntry[]> {
    const cached = this.childrenByPath.get(path);
    if (cached) return cached;
    const parent = this.info.get(path);
    if (!parent) throw new Error(`Unknown path: ${path}`);
    if (parent.mimeType !== FOLDER_MIME) {
      // a single shared file acts as a one-entry workspace
      if (path === '') {
        const entry = this.toEntry(parent, '');
        const out = [entry];
        this.childrenByPath.set('', out);
        return out;
      }
      return [];
    }
    const data = await apiJson<{ files?: Meta[] }>('/files', this.key, {
      q: `'${parent.id}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,size)',
      pageSize: '200',
      orderBy: 'name',
    }, this.resourceKey);
    const entries = sortEntries((data.files ?? []).map((m) => this.toEntry(m, path)));
    this.childrenByPath.set(path, entries);
    return entries;
  }

  private async resolve(path: string): Promise<Meta> {
    if (path === '') return this.info.get('')!;
    let meta = this.info.get(path);
    if (!meta) {
      await this.listDir(dirname(path));
      meta = this.info.get(path);
    }
    if (!meta) throw new Error(`Not found in this Drive folder: ${basename(path)}`);
    return meta;
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const meta = await this.resolve(path);
    return downloadFile(meta.id, this.key, meta.mimeType, this.resourceKey);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async writeFile(): Promise<void> {
    throw new Error('Google Drive workspaces are read-only in v0.2');
  }
}

/** Fetch metadata for a link/ID and build the provider (also remembers it). */
export async function openGDriveLink(link: string, key: string): Promise<GDriveProvider | null> {
  const ref = parseGDriveLink(link);
  if (!ref) return null;
  const rootMeta = await apiJson<Meta>(`/files/${encodeURIComponent(ref.id)}`, key, { fields: 'id,name,mimeType' }, ref.resourceKey);
  const provider = new GDriveProvider(rootMeta, key, ref.resourceKey);
  await kvSet('last', { kind: 'gdrive', label: provider.label, rootId: ref.id });
  await addRecent({ kind: 'gdrive', label: provider.label, id: ref.id, ts: Date.now() });
  return provider;
}

/** Reopen a remembered Drive workspace (session restore / recents). */
export async function createGDriveProvider(rootId: string, key: string, resourceKey?: string): Promise<GDriveProvider> {
  const rootMeta = await apiJson<Meta>(`/files/${encodeURIComponent(rootId)}`, key, { fields: 'id,name,mimeType' }, resourceKey);
  return new GDriveProvider(rootMeta, key, resourceKey);
}

/* ---------- keyless access for Google-native files ---------- */

/**
 * Google Doc / Sheet / Slides export endpoints are CORS-enabled, so link-shared
 * files open without any API key. Uploaded binaries (PDF/DOCX/…) are served
 * from drive.google.com without CORS headers — Google blocks browser-direct
 * downloads, so those need the API-key path.
 */

const EXPORT_URLS: Record<string, { url: (id: string) => string; name: string; ext: string }> = {
  gdoc: { url: (id) => `https://docs.google.com/document/d/${id}/export?format=txt`, name: 'Google Doc', ext: 'txt' },
  gsheet: { url: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, name: 'Google Sheet', ext: 'csv' },
  gppt: { url: (id) => `https://docs.google.com/presentation/d/${id}/export/txt`, name: 'Google Slides', ext: 'txt' },
};

/** A one-file workspace built from a keyless export. */
export class GDriveKeylessProvider implements FileSystemProvider {
  readonly kind = 'gdrive' as const;
  readonly canWrite = false;
  readonly id: string;
  readonly label: string;
  private buffer: ArrayBuffer;
  private fileName: string;

  constructor(rootId: string, label: string, fileName: string, buffer: ArrayBuffer) {
    this.id = `gdrive-file:${rootId}`;
    this.label = label;
    this.fileName = fileName;
    this.buffer = buffer;
  }

  listDir(): Promise<FsEntry[]> {
    return Promise.resolve([{
      name: this.fileName,
      path: this.fileName,
      kind: 'file',
      ext: extOf(this.fileName),
      size: this.buffer.byteLength,
    }]);
  }
  readFile(): Promise<ArrayBuffer> { return Promise.resolve(this.buffer.slice(0)); }
  async readText(): Promise<string> { return new TextDecoder().decode(this.buffer.slice(0)); }
  async writeFile(): Promise<void> { throw new Error('Google Drive workspaces are read-only'); }
}

async function fetchKeylessExport(id: string, hint: 'gdoc' | 'gsheet' | 'gppt', resourceKey?: string): Promise<{ name: string; buffer: ArrayBuffer }> {
  const spec = EXPORT_URLS[hint];
  let res: Response;
  try {
    res = await fetch(spec.url(id) + (resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ''));
  } catch {
    throw new Error('Google blocked the direct browser request (network/CORS). Try again or use an API key.');
  }
  if (!res.ok) {
    throw new Error(`Google returned ${res.status}. Make sure the file is shared as “Anyone with the link can view”.`);
  }
  const type = res.headers.get('content-type') ?? '';
  const buffer = await res.arrayBuffer();
  if (type.includes('text/html')) {
    throw new Error('Google returned a sign-in page — this file is not public. Share it as “Anyone with the link can view”.');
  }
  return { name: `${spec.name}.${spec.ext}`, buffer };
}

export async function openGDriveKeyless(link: string): Promise<GDriveKeylessProvider | null> {
  const ref = parseGDriveLink(link);
  if (!ref || !(ref.hint in EXPORT_URLS)) return null;
  const { name, buffer } = await fetchKeylessExport(ref.id, ref.hint as 'gdoc' | 'gsheet' | 'gppt', ref.resourceKey);
  const provider = new GDriveKeylessProvider(ref.id, name, name, buffer);
  await kvSet('last', { kind: 'gdrivefile', label: name, rootId: ref.id, hint: ref.hint });
  await addRecent({ kind: 'gdrive', label: name, id: ref.id, ts: Date.now(), hint: ref.hint });
  return provider;
}

/** Reopen a remembered keyless file workspace (session restore / recents). */
export async function createGDriveKeyless(rootId: string, hint: 'gdoc' | 'gsheet' | 'gppt', resourceKey?: string): Promise<GDriveKeylessProvider> {
  const { name, buffer } = await fetchKeylessExport(rootId, hint, resourceKey);
  return new GDriveKeylessProvider(rootId, name, name, buffer);
}
