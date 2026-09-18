import { api, exportMimeFor, mimeFromName, type Candidate, type DriveFile } from '../../services/api';
import type { FileSystemProvider } from '../../services/fs/types';
import { basename } from '../../services/fs/types';
import { useTransfers } from '../../stores/transfers';
import { useWorkspace } from '../../stores/workspace';
import { toast } from '../../stores/toast';

/** Browser directory picker for download destinations; 'unavailable' → fallback mode. */
export async function pickLocalDestination(): Promise<FileSystemDirectoryHandle | 'cancelled' | 'unavailable'> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  // navigator.webdriver ⇒ automation (headless): the native picker never resolves there
  const automated = (navigator as unknown as { webdriver?: boolean }).webdriver === true;
  if (!picker || automated) return 'unavailable';
  try {
    return await picker({ mode: 'readwrite' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
    return 'unavailable';
  }
}

function fallbackDownload(name: string, content: ArrayBuffer) {
  const blob = new Blob([content]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

function uniqueName(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  let candidate = `${base} (${i})${ext}`;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${base} (${i})${ext}`;
  }
  return candidate;
}

/** Upload File objects (from a file picker) into a Drive folder. */
export async function uploadFilesToDrive(files: File[], dest: { id: string; name: string }) {
  const t = useTransfers.getState();
  const jobId = t.startJob('upload', `Upload to “${dest.name}”`, files.map((f) => ({ name: f.name, size: f.size })));
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    if (useTransfers.getState().isCancelled(jobId)) break;
    useTransfers.getState().setItem(jobId, i, { status: 'active' });
    try {
      const buf = await files[i].arrayBuffer();
      const { file } = await api.driveUpload(dest.id, files[i].name, files[i].type || mimeFromName(files[i].name), buf);
      useTransfers.getState().setItem(jobId, i, { status: 'succeeded' });
      void file;
      ok++;
    } catch (e) {
      useTransfers.getState().setItem(jobId, i, { status: 'failed', error: String((e as Error).message) });
      failed++;
    }
  }
  finish(jobId, ok, failed, files.length, {
    direction: 'upload',
    destinationDriveFolderId: dest.id,
    items: files.map((f, i) => useTransfers.getState().jobs.find((j) => j.id === jobId)!.items[i]),
  });
}

/** Upload files from an open local workspace after the review step (DRV-05/M5). */
export async function uploadCandidatesToDrive(
  provider: FileSystemProvider,
  candidates: Candidate[],
  dest: { id: string; name: string },
): Promise<{ ok: number; failed: number }> {
  const t = useTransfers.getState();
  const jobId = t.startJob('upload', `Upload new files → “${dest.name}”`, candidates.map((c) => ({ name: c.relativePath, size: c.size })));
  let ok = 0;
  let failed = 0;
  let baseFolderId = dest.id;
  if (dest.id.startsWith('create:')) {
    const folderName = dest.name || dest.id.slice('create:'.length);
    try {
      const { files } = await api.driveList('root');
      const existing = files.find((f) => f.name === folderName && f.mimeType === 'application/vnd.google-apps.folder');
      if (existing) {
        baseFolderId = existing.id;
      } else {
        const { file } = await api.driveUpload('root', folderName, 'application/vnd.google-apps.folder', '');
        baseFolderId = file.id;
      }
      dest.id = baseFolderId;
      try {
        localStorage.setItem(`rs.driveSyncDest.${provider.id}`, JSON.stringify({ id: baseFolderId, name: folderName }));
      } catch { /* ignore */ }
    } catch (e) {
      console.warn('Failed to resolve or create target folder in Drive:', e);
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    if (useTransfers.getState().isCancelled(jobId)) break;
    useTransfers.getState().setItem(jobId, i, { status: 'active' });
    try {
      const buf = await provider.readFile(candidates[i].relativePath);
      // Drive paths use folders — create the folder chain if needed
      const targetId = await ensureFolderPath(baseFolderId, candidates[i].relativePath.split('/').slice(0, -1));
      const fileName = basename(candidates[i].relativePath);
      const { file } = await api.driveUpload(targetId, fileName, mimeFromName(fileName), buf);
      useTransfers.getState().setItem(jobId, i, { status: 'succeeded' });
      useWorkspace.getState().markCandidateUploaded(candidates[i].relativePath);
      void file;
      ok++;
    } catch (e) {
      useTransfers.getState().setItem(jobId, i, { status: 'failed', error: String((e as Error).message) });
      failed++;
    }
  }
  finish(jobId, ok, failed, candidates.length, {
    direction: 'upload',
    destinationDriveFolderId: dest.id,
    items: candidates.map((c, i) => ({
      relativePath: c.relativePath,
      fileName: basename(c.relativePath),
      size: c.size,
      ...(useTransfers.getState().jobs.find((j) => j.id === jobId)!.items[i] ?? {}),
    })),
  });
  return { ok, failed };
}

/** Create missing Drive subfolders along a relative path (folder IDs, not names). */
const folderCache = new Map<string, Promise<string>>();
export function ensureFolderPath(rootId: string, segments: string[]): Promise<string> {
  if (segments.length === 0) return Promise.resolve(rootId);
  const key = `${rootId}::${segments.join('/')}`;
  const cached = folderCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    let parentId = rootId;
    for (const seg of segments) {
      const { files } = await api.driveList(parentId);
      const existing = files.find((f) => f.name === seg && f.mimeType === 'application/vnd.google-apps.folder');
      if (existing) {
        parentId = existing.id;
      } else {
        const { file } = await api.driveUpload(parentId, seg, 'application/vnd.google-apps.folder', '');
        parentId = file.id;
      }
    }
    return parentId;
  })();
  folderCache.set(key, promise);
  return promise;
}

/** Download Drive files/folder to a local destination (DRV-06/M6). */
export async function downloadFromDrive(
  selection: { files: DriveFile[]; rootFolder?: { id: string; name: string } },
  destination: FileSystemDirectoryHandle | null,
) {
  const files: Array<{ file: DriveFile; relativePath: string }> = [];
  const t0 = useTransfers.getState();

  // recursive traversal for folders, with a count preview before starting
  const queue: Array<{ id: string; rel: string }> = [];
  if (selection.rootFolder) queue.push({ id: selection.rootFolder.id, rel: selection.rootFolder.name });
  for (const f of selection.files) {
    if (f.mimeType === 'application/vnd.google-apps.folder') queue.push({ id: f.id, rel: f.name });
    else files.push({ file: f, relativePath: f.name });
  }
  while (queue.length > 0) {
    const { id, rel } = queue.shift()!;
    try {
      const { files: children } = await api.driveList(id);
      for (const c of children) {
        if (c.mimeType === 'application/vnd.google-apps.folder') queue.push({ id: c.id, rel: `${rel}/${c.name}` });
        else files.push({ file: c, relativePath: `${rel}/${c.name}` });
      }
      if (files.length > 200) break; // safety valve; preview shows the count
    } catch {
      /* skip unreadable subfolder, results show it */
    }
  }

  const names = files.map((f) => f.relativePath);
  const jobId = t0.startJob('download', destination ? `Download → local folder` : `Download (browser saves)`, names.map((n) => ({ name: n })), !destination);
  const usedNames = new Set<string>();
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    if (useTransfers.getState().isCancelled(jobId)) break;
    const { file, relativePath } = files[i];
    useTransfers.getState().setItem(jobId, i, { status: 'active' });
    try {
      const ex = exportMimeFor(file.mimeType);
      const buffer = await api.driveContent(file.id, ex?.mime);
      const name = uniqueName(usedNames, basename(relativePath));
      usedNames.add(name);
      if (destination) {
        const dir = await ensureLocalDir(destination, relativePath.split('/').slice(0, -1));
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await (fh as unknown as { createWritable: () => Promise<{ write: (d: ArrayBuffer) => Promise<void>; close: () => Promise<void> }> }).createWritable();
        await w.write(new Uint8Array(buffer));
        await w.close();
      } else {
        fallbackDownload(name, new Uint8Array(buffer));
      }
      useTransfers.getState().setItem(jobId, i, { status: 'succeeded' });
      ok++;
    } catch (e) {
      useTransfers.getState().setItem(jobId, i, { status: 'failed', error: String((e as Error).message) });
      failed++;
    }
  }
  finish(jobId, ok, failed, files.length, {
    direction: 'download',
    items: files.map((f, i) => ({
      relativePath: f.relativePath,
      fileName: basename(f.relativePath),
      size: f.file.size ? Number(f.file.size) : undefined,
      ...(useTransfers.getState().jobs.find((j) => j.id === jobId)!.items[i] ?? {}),
    })),
  });
}

async function ensureLocalDir(dir: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle> {
  let cur = dir;
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, { create: true });
  }
  return cur;
}

/** Persist job metadata to the server (never contents — PRD §6). */
function finish(jobId: string, ok: number, failed: number, total: number, record: Record<string, unknown>) {
  const job = useTransfers.getState().jobs.find((j) => j.id === jobId);
  if (!job) return;
  const status = failed === 0 ? 'succeeded' : ok + failed < total ? 'partial' : failed === total ? 'failed' : 'partial';
  useTransfers.getState().finishJob(jobId, useTransfers.getState().isCancelled(jobId) ? 'cancelled' : status);
  void api.transfersRecord({
    direction: record.direction,
    destinationDriveFolderId: record.destinationDriveFolderId,
    status,
    items: record.items,
  }).catch(() => undefined);
  if (failed === 0) toast(`${ok} file(s) ${job.kind === 'upload' ? 'uploaded' : 'downloaded'}`, 'ok');
  else toast(`${ok} succeeded · ${failed} failed — retry from the transfer panel`, 'warn');
}
