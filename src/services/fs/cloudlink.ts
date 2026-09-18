import type { FileSystemProvider, FsEntry } from './types';
import { extOf, sortEntries } from './types';
import { api, exportMimeFor, type SavedLink } from '../api';
import { kvSet, addRecent } from '../persistence';
import { setScrollFor } from '../../components/ViewerHost';

/**
 * Read-only provider for *link-shared* Drive resources (Saved Links, PRD v1.1 §9).
 * Reads go through the server-side Drive proxy, so it works for any signed-in,
 * Drive-connected user without an API key. Link-shared files may require their
 * original `resourceKey` — ReadSpace preserves it with the saved link and sends
 * it on every request. Saving never grants access: if the owner revokes sharing,
 * the server returns 404 and the app says so instead of hiding the link.
 */
export class CloudLinkProvider implements FileSystemProvider {
  readonly kind = 'cloudlink' as const;
  readonly canWrite = false;
  readonly id: string;
  readonly label: string;

  private readonly rootId: string;
  private readonly isFolder: boolean;
  private readonly resourceKey?: string;
  private meta: { id: string; name: string; mimeType: string; size?: string } | null;
  /** path -> Drive id ('' is the shared root) */
  private ids = new Map<string, string>();
  private mimes = new Map<string, string>();
  private children = new Map<string, FsEntry[]>();

  constructor(ref: { id: string; name: string; mimeType?: string; label?: string; resourceKey?: string }) {
    this.rootId = ref.id;
    this.isFolder = ref.mimeType === 'application/vnd.google-apps.folder';
    this.resourceKey = ref.resourceKey;
    this.meta = { id: ref.id, name: ref.name, mimeType: ref.mimeType ?? 'application/octet-stream' };
    this.label = ref.label ?? ref.name;
    this.id = `cloudlink:${ref.id}`;
    this.ids.set('', ref.id);
  }

  private toEntry(name: string, id: string, mimeType: string, size: string | undefined, parentPath: string): FsEntry {
    const path = parentPath ? `${parentPath}/${name}` : name;
    this.ids.set(path, id);
    this.mimes.set(path, mimeType);
    const dir = mimeType === 'application/vnd.google-apps.folder';
    return { name, path, kind: dir ? 'directory' : 'file', ext: dir ? undefined : (extOf(name) ?? undefined), size: size ? Number(size) : undefined };
  }

  async listDir(path: string): Promise<FsEntry[]> {
    const cached = this.children.get(path);
    if (cached) return cached;
    const id = this.ids.get(path);
    if (id == null) throw new Error(`Unknown path: ${path}`);
    if (!this.isFolder && path === '') {
      const e = this.toEntry(this.meta!.name, this.meta!.id, this.meta!.mimeType, this.meta!.size, '');
      const out = [e];
      this.children.set('', out);
      return out;
    }
    const { files } = await api.driveList(id, this.resourceKey);
    const entries = sortEntries(files.map((f) => this.toEntry(f.name, f.id, f.mimeType, f.size, path)));
    this.children.set(path, entries);
    return entries;
  }

  private async resolve(path: string): Promise<{ id: string; mimeType: string; name: string }> {
    if (path === '') return { id: this.rootId, mimeType: this.meta!.mimeType, name: this.meta!.name };
    if (!this.ids.has(path)) await this.listDir(path.split('/').slice(0, -1).join('/'));
    const id = this.ids.get(path);
    if (!id) throw new Error(`Not found in this shared link: ${path}`);
    return { id, mimeType: this.mimes.get(path) ?? 'application/octet-stream', name: path.split('/').pop() ?? path };
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const meta = await this.resolve(path);
    const ex = exportMimeFor(meta.mimeType);
    return api.driveContent(meta.id, ex?.mime, this.resourceKey);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async writeFile(): Promise<void> {
    throw new Error('Shared links open read-only — saving a link is a reference, not ownership');
  }

  /** Drive id for a path (progress sync + download entry points). */
  fileIdFor(path: string): string | undefined {
    return path === '' ? this.rootId : this.ids.get(path);
  }
}

/** Open a saved link as a workspace (signed-in + Drive connected). */
export async function openCloudLink(link: SavedLink): Promise<CloudLinkProvider> {
  const id = link.folderId ?? link.fileId;
  if (!id) throw new Error('This saved link has no Drive resource id');
  let name = link.title;
  let mimeType = link.mimeType;
  try {
    // refresh name/type — the owner may have renamed or revoked since saving
    const meta = await api.driveMeta(id, link.resourceKey);
    name = meta.name || name;
    mimeType = meta.mimeType;
  } catch (e) {
    throw new Error(revokedMessage(e));
  }
  const provider = new CloudLinkProvider({ id, name, mimeType, label: name, resourceKey: link.resourceKey });
  // resume reading progress for single-file links (ViewerHost reads this on mount)
  if (!link.folderId && link.progress && link.progress.scrollTop > 0) setScrollFor(name, link.progress.scrollTop);
  await kvSet('last', { kind: 'cloudlink', rootId: link._id, label: name });
  await addRecent({ kind: 'gdrive', label: name, id, ts: Date.now() });
  return provider;
}

/** Friendly message when the owner has revoked (or the key is stale). */
export function revokedMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/404|not available|notFound/i.test(msg)) {
    return 'The owner may have removed access, or the link needs its original resource key. The saved link was kept.';
  }
  return msg;
}
