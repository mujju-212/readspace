import type { FileSystemProvider, FsEntry, FileStat } from './types';
import { basename, dirname, sortEntries, extOf } from './types';

/**
 * Primary provider: File System Access API (Chromium).
 * Gives read + write access to a real folder via a persistent directory handle.
 */
export class FsaProvider implements FileSystemProvider {
  readonly kind = 'fsa' as const;
  readonly canWrite = true;
  readonly id: string;
  readonly label: string;

  private dirCache = new Map<string, FileSystemDirectoryHandle>();
  private fileCache = new Map<string, FileSystemFileHandle>();

  constructor(private root: FileSystemDirectoryHandle) {
    this.label = root.name || 'folder';
    this.id = `fsa:${root.name}`;
    this.dirCache.set('', root);
  }

  get handle(): FileSystemDirectoryHandle {
    return this.root;
  }

  private async dirAt(path: string): Promise<FileSystemDirectoryHandle> {
    const normalized = (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return this.root;
    const cached = this.dirCache.get(normalized);
    if (cached) return cached;

    let dir = this.root;
    let built = '';
    for (const seg of normalized.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(seg);
      built = built ? `${built}/${seg}` : seg;
      this.dirCache.set(built, dir);
    }
    return dir;
  }

  private async fileAt(path: string): Promise<FileSystemFileHandle> {
    const normalized = (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const cached = this.fileCache.get(normalized);
    if (cached) return cached;
    const dir = await this.dirAt(dirname(normalized));
    const fh = await dir.getFileHandle(basename(normalized));
    this.fileCache.set(normalized, fh);
    return fh;
  }

  async listDir(path: string): Promise<FsEntry[]> {
    const dir = await this.dirAt(path);
    const out: FsEntry[] = [];
    const iterable = dir as unknown as { values(): AsyncIterable<FileSystemHandle> };
    for await (const entry of iterable.values()) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        this.dirCache.set(entryPath, entry as FileSystemDirectoryHandle);
      } else {
        this.fileCache.set(entryPath, entry as FileSystemFileHandle);
      }
      out.push({
        name: entry.name,
        path: entryPath,
        kind: entry.kind,
        ext: entry.kind === 'file' ? extOf(entry.name) : undefined,
      });
    }
    return sortEntries(out);
  }

  async stat(path: string): Promise<FileStat> {
    const fh = await this.fileAt(path);
    const file = await fh.getFile();
    return { size: file.size, modifiedTime: new Date(file.lastModified).toISOString() };
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const fh = await this.fileAt(path);
    return (await fh.getFile()).arrayBuffer();
  }

  async readText(path: string): Promise<string> {
    const fh = await this.fileAt(path);
    const file = await fh.getFile();
    return file.text();
  }

  async writeFile(path: string, data: string): Promise<void> {
    const fh = await this.fileAt(path);
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }
}
