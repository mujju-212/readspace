import type { FileSystemProvider } from './types';
import { FsaProvider } from './fsa';
import { FallbackProvider } from './fallback';
import { SampleProvider } from './sample';
import { addRecent, putHandle, kvSet, putSnapshot, type SnapshotFile } from '../persistence';

/** Everything that can turn a user gesture into an installed workspace. */

export function fsaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Chrome / Edge: native folder picker with read-write access.
 *  Resolves 'blocked' when the picker is unavailable (e.g. permissions policy
 *  inside a cross-origin iframe) so the caller can fall back. */
export async function openFolderFsa(): Promise<FsaProvider | null | 'blocked'> {
  if (!fsaSupported()) return 'blocked';
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
  } catch (e: any) {
    if (e?.name === 'AbortError') return null; // user cancelled
    // Try without mode option in case browser restricts or dislikes the option dictionary
    try {
      handle = await window.showDirectoryPicker!();
    } catch (e2: any) {
      if (e2?.name === 'AbortError') return null;
      return 'blocked';
    }
  }

  await Promise.all([
    putHandle(handle.name, handle),
    putHandle('last', handle),
    putHandle(`fsa:${handle.name}`, handle),
    addRecent({ kind: 'fsa', label: handle.name, ts: Date.now() }),
    kvSet('last', { kind: 'fsa', label: handle.name }),
  ]);

  // Save snapshot in background so reload renders immediately with 100% of structure
  void saveFsaSnapshot(handle);

  return new FsaProvider(handle);
}

/** Background snapshot builder for FSA workspaces (enables instant offline/reload restoration). */
async function saveFsaSnapshot(root: FileSystemDirectoryHandle): Promise<void> {
  try {
    const snapshot: SnapshotFile[] = [];
    let totalBytes = 0;
    const MAX_TOTAL_BYTES = 250 * 1024 * 1024; // 250MB buffer limit
    const MAX_FILE_SIZE = 40 * 1024 * 1024;

    async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
      const iterable = dir as unknown as { values(): AsyncIterable<FileSystemHandle> };
      for await (const entry of iterable.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          snapshot.push({ path, name: entry.name, type: 'directory', size: 0, buffer: new ArrayBuffer(0), isDir: true });
          await walk(entry as FileSystemDirectoryHandle, path);
        } else if (entry.kind === 'file') {
          try {
            const fh = entry as FileSystemFileHandle;
            const file = await fh.getFile();
            if (totalBytes + file.size <= MAX_TOTAL_BYTES && file.size <= MAX_FILE_SIZE) {
              const buf = await file.arrayBuffer();
              snapshot.push({ path, name: file.name, type: file.type, size: file.size, buffer: buf });
              totalBytes += file.size;
            } else {
              snapshot.push({ path, name: file.name, type: file.type, size: file.size, buffer: new ArrayBuffer(0) });
            }
          } catch {
            snapshot.push({ path, name: entry.name, type: '', size: 0, buffer: new ArrayBuffer(0) });
          }
        }
      }
    }

    await walk(root, '');
    if (snapshot.length > 0) {
      await Promise.all([
        putSnapshot(root.name, snapshot),
        putSnapshot(`fsa:${root.name}`, snapshot),
        putSnapshot('last', snapshot),
      ]);
    }
  } catch (err) {
    console.warn('[fsa] background snapshot failed:', err);
  }
}

/** Firefox / Safari: read-only folder snapshot via <input webkitdirectory>. */
export function openFolderFallback(): Promise<FallbackProvider | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length === 0) return resolve(null);
      const p = new FallbackProvider(files);
      await Promise.all([
        addRecent({ kind: 'fallback', label: p.label, ts: Date.now() }),
        kvSet('last', { kind: 'fallback', label: p.label }),
      ]);

      // Save files and all directory paths to IndexedDB snapshot store so reload restores 100% of structure!
      const snapshot: SnapshotFile[] = [];

      // Add all discovered directory paths
      for (const d of p.getDirs()) {
        const segs = d.split('/');
        snapshot.push({
          path: d,
          name: segs[segs.length - 1],
          type: 'directory',
          size: 0,
          buffer: new ArrayBuffer(0),
          isDir: true,
        });
      }

      let totalBytes = 0;
      const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300MB buffer cap
      const MAX_FILE_SIZE = 40 * 1024 * 1024;
      for (const f of files) {
        const rawRel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const rel = rawRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const parts = rel.split('/').filter(Boolean);
        parts.shift(); // remove root folder
        const path = parts.join('/') || f.name;
        try {
          if (totalBytes + f.size <= MAX_TOTAL_BYTES && f.size <= MAX_FILE_SIZE) {
            const buf = await f.arrayBuffer();
            snapshot.push({ path, name: f.name, type: f.type, size: f.size, buffer: buf });
            totalBytes += f.size;
          } else {
            // Preserve file entry so directory hierarchy and files are 100% complete!
            snapshot.push({ path, name: f.name, type: f.type, size: f.size, buffer: new ArrayBuffer(0) });
          }
        } catch {
          snapshot.push({ path, name: f.name, type: f.type, size: f.size, buffer: new ArrayBuffer(0) });
        }
      }
      if (snapshot.length > 0) {
        await Promise.all([
          putSnapshot(p.label, snapshot),
          putSnapshot('last', snapshot),
        ]);
      }

      resolve(p);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Open Folder — picks the best mechanism for this browser. */
export async function openFolderFlow(): Promise<FileSystemProvider | null> {
  if (fsaSupported()) {
    const picked = await openFolderFsa();
    if (picked !== 'blocked') return picked;
    // picker blocked (iframe permissions policy etc.) → read-only snapshot picker
  }
  return openFolderFallback();
}

export async function loadSample(): Promise<SampleProvider> {
  await addRecent({ kind: 'sample', label: 'Sample workspace', ts: Date.now() });
  await kvSet('last', { kind: 'sample', label: 'sample' });
  return new SampleProvider();
}

/** Re-connect a previously granted folder (welcome screen / restore). */
export async function reconnectFsa(handle: FileSystemDirectoryHandle): Promise<FsaProvider | null> {
  try {
    const perm = (handle as unknown as {
      queryPermission?: (d?: { mode: string }) => Promise<PermissionState>;
      requestPermission?: (d?: { mode: string }) => Promise<PermissionState>;
    });
    let state = await perm.queryPermission?.({ mode: 'readwrite' });
    if (state !== 'granted') {
      state = await perm.queryPermission?.({ mode: 'read' });
    }
    if (state !== 'granted') {
      try {
        state = await perm.requestPermission?.({ mode: 'readwrite' });
      } catch {
        state = await perm.requestPermission?.({ mode: 'read' });
      }
    }
    if (state === 'granted') {
      const p = new FsaProvider(handle);
      await putHandle(p.label, handle);
      await putHandle('last', handle);
      await kvSet('last', { kind: 'fsa', label: p.label });
      await addRecent({ kind: 'fsa', label: p.label, ts: Date.now() });
      void saveFsaSnapshot(handle);
      return p;
    }
    return null;
  } catch (err) {
    console.warn('[fsa] reconnectFsa error:', err);
    return null;
  }
}
