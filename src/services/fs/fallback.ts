import type { FileSystemProvider, FsEntry, FileStat } from './types';
import { dirname, extOf, sortEntries } from './types';

/**
 * Fallback provider for Firefox / Safari: <input webkitdirectory>
 * Read-only snapshot of the picked folder (TRD §3.1 — fallback path).
 */
export class FallbackProvider implements FileSystemProvider {
  readonly kind = 'fallback' as const;
  readonly canWrite = false;
  readonly id: string;
  readonly label: string;

  private files = new Map<string, File>();
  private dirs = new Set<string>();

  constructor(fileList: File[], extraDirs?: string[]) {
    let rootName = 'folder';
    for (const f of fileList) {
      const rawRel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const rel = rawRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const parts = rel.split('/').filter(Boolean);
      if (parts.length > 1) rootName = parts[0];
      parts.shift(); // strip the picked folder itself
      if (parts.length === 0) continue;
      const path = parts.join('/');
      this.files.set(path, f);
      for (let i = 1; i <= parts.length - 1; i++) {
        this.dirs.add(parts.slice(0, i).join('/'));
      }
    }
    if (extraDirs) {
      for (const d of extraDirs) {
        const clean = d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (clean) this.dirs.add(clean);
      }
    }
    this.label = rootName;
    this.id = `fallback:${rootName}`;
  }

  getDirs(): string[] {
    return Array.from(this.dirs);
  }

  listDir(path: string): Promise<FsEntry[]> {
    const cleanPath = (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const prefix = cleanPath ? `${cleanPath}/` : '';
    const seen = new Set<string>();
    const out: FsEntry[] = [];

    for (const d of this.dirs) {
      if (!d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      seen.add(rest);
      out.push({ name: rest, path: d, kind: 'directory' });
    }
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      if (seen.has(rest)) continue;
      const file = this.files.get(p)!;
      out.push({ name: rest, path: p, kind: 'file', ext: extOf(rest), size: file.size });
    }
    return Promise.resolve(sortEntries(out));
  }

  stat(path: string): Promise<FileStat> {
    const cleanPath = (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const f = this.files.get(cleanPath);
    if (!f) return Promise.reject(new Error(`Not found: ${cleanPath}`));
    return Promise.resolve({ size: f.size, modifiedTime: new Date(f.lastModified).toISOString() });
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const cleanPath = (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const f = this.files.get(cleanPath);
    if (!f) throw new Error(`Not found: ${cleanPath}`);
    const buf = await f.arrayBuffer();
    if (f.size > 0 && buf.byteLength === 0) {
      throw new Error(`File "${cleanPath}" (${Math.round(f.size / 1024)} KB) was not cached in offline storage. Use "Open Folder" to reload full contents.`);
    }
    return buf;
  }

  readText(path: string): Promise<string> {
    const cleanPath = (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const f = this.files.get(cleanPath);
    if (!f) return Promise.reject(new Error(`Not found: ${cleanPath}`));
    return f.text();
  }

  async writeFile(): Promise<void> {
    throw new Error('read-only workspace');
  }
}
