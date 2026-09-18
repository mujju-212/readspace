import type { FileSystemProvider, FsEntry, FileStat } from './types';
import { sortEntries, extOf } from './types';
import { api, exportMimeFor, mimeFromName, type DriveFile } from '../api';

/** Thrown when the remote file changed after we opened it (SYNC-01). */
export class DriveConflictError extends Error {
  constructor(public remote: { name?: string; modifiedTime?: string }, public savedText: string) {
    super('The file changed on Google Drive after you opened it.');
  }
}

const FOLDER = 'application/vnd.google-apps.folder';
const NATIVE = ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation'];

/**
 * Provider for the user's connected Google Drive (OAuth, server-proxied).
 * Keeps a path→DriveFile map so saves can do modifiedTime conflict checks.
 */
export class CloudDriveProvider implements FileSystemProvider {
  readonly kind = 'clouddrive' as const;
  readonly canWrite = true;
  readonly id: string;
  label: string;  // updated from the Drive root's metadata on first list

  public byPath = new Map<string, DriveFile>();

  getFolderId(path: string): string | undefined {
    return this.byPath.get(path)?.id;
  }

  private dirCache = new Map<string, { entries: FsEntry[]; time: number }>();
  private rootMetaLoaded = false;

  constructor(public rootId: string, label?: string) {
    this.id = `clouddrive:${rootId}`;
    this.label = label ?? 'Google Drive';
  }

  get isCloud(): true { return true; }

  private toEntry(f: DriveFile, parentPath: string): FsEntry {
    const path = parentPath ? `${parentPath}/${f.name}` : f.name;
    this.byPath.set(path, f);
    const isFolder = f.mimeType === FOLDER;
    const nativeExt = exportMimeFor(f.mimeType)?.ext;
    return {
      name: f.name,
      path,
      kind: isFolder ? 'directory' : 'file',
      ext: isFolder ? undefined : (extOf(f.name) || nativeExt),
      size: f.size ? Number(f.size) : undefined,
    };
  }

  async listDir(path: string, force = false): Promise<FsEntry[]> {
    if (!force) {
      const cached = this.dirCache.get(path);
      if (cached && Date.now() - cached.time < 45000) {
        return cached.entries;
      }
    }

    let parentId: string;
    if (path === '') {
      parentId = this.rootId;
      if (!this.rootMetaLoaded) {
        this.rootMetaLoaded = true;
        api.driveMeta(this.rootId).then((meta) => {
          if (meta?.name) this.label = meta.name;
        }).catch(() => {});
      }
    } else {
      const meta = this.byPath.get(path);
      if (!meta) throw new Error(`Unknown Drive path: ${path}`);
      parentId = meta.id;
    }
    const { files } = await api.driveList(parentId);
    const entries = sortEntries(files.map((f) => this.toEntry(f, path)));
    this.dirCache.set(path, { entries, time: Date.now() });
    return entries;
  }

  private async metaFor(path: string): Promise<DriveFile> {
    const known = this.byPath.get(path);
    if (known) return known;
    // resolve segment by segment so freshly-restored sessions can open
    // nested paths without any prior listing (SYNC-03 restore path)
    const segs = path.split('/').filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      const prefix = segs.slice(0, i + 1).join('/');
      if (!this.byPath.has(prefix)) {
        await this.listDir(segs.slice(0, i).join('/'));
        if (!this.byPath.has(prefix)) throw new Error(`Not found in Drive: ${path}`);
      }
    }
    const m = this.byPath.get(path);
    if (!m) throw new Error(`Not found in Drive: ${path}`);
    return m;
  }

  async stat(path: string): Promise<FileStat> {
    const meta = this.byPath.get(path) ?? (await this.metaFor(path));
    return { size: Number(meta.size ?? 0), modifiedTime: meta.modifiedTime };
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const meta = await this.metaFor(path);
    if (NATIVE.includes(meta.mimeType)) {
      const ex = exportMimeFor(meta.mimeType)!;
      return api.driveContent(meta.id, ex.mime);
    }
    return api.driveContent(meta.id);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  /** Save back to Drive with conflict detection (DRV-07 + SYNC-01). */
  async writeFile(path: string, data: string): Promise<void> {
    const meta = await this.metaFor(path);
    try {
      const { file } = await api.driveUpdate(meta.id, data, meta.modifiedTime);
      this.byPath.set(path, { ...meta, ...file, modifiedTime: file.modifiedTime ?? meta.modifiedTime });
      this.dirCache.clear();
    } catch (e) {
      if ((e as { codeName?: string }).codeName === 'remote_changed') {
        throw new DriveConflictError((e as { remote?: { name?: string; modifiedTime?: string } }).remote ?? {}, data);
      }
      throw e;
    }
  }

  fileIdFor(path: string): string | undefined {
    return this.byPath.get(path)?.id;
  }

  /** Deliberate overwrite after the user confirmed a conflict (SYNC-01 flow). */
  async writeFileForce(path: string, data: string): Promise<void> {
    const meta = await this.metaFor(path);
    const { file } = await api.driveUpdate(meta.id, data);
    this.byPath.set(path, { ...meta, ...file, modifiedTime: file.modifiedTime ?? meta.modifiedTime });
    this.dirCache.clear();
  }

  /** Save the user's version as a new file next to the original. */
  async saveCopy(path: string, data: string): Promise<void> {
    const meta = await this.metaFor(path);
    const dot = meta.name.lastIndexOf('.');
    const copyName = dot > 0 ? `${meta.name.slice(0, dot)} (my copy)${meta.name.slice(dot)}` : `${meta.name} (my copy)`;
    await api.driveUpload(meta.parents?.[0] ?? 'root', copyName, mimeFromName(meta.name), data);
    this.dirCache.clear();
  }
}

export const DRIVE_FOLDER_MIME = FOLDER;
export { mimeFromName };
