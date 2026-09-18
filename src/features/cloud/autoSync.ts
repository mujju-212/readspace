import { useWorkspace } from '../../stores/workspace';
import { useAuth } from '../../stores/auth';
import { api, type Candidate } from '../../services/api';

export interface DriveSyncDest {
  id: string;
  name: string;
  isNew?: boolean;
}

export async function getOrResolveDriveDest(workspaceId: string, workspaceLabel: string): Promise<DriveSyncDest> {
  // 1. Check remembered destination for this workspace
  try {
    const raw = localStorage.getItem(`rs.driveSyncDest.${workspaceId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id && parsed?.name) return parsed;
    }
  } catch { /* ignore */ }

  // 2. Search Drive root for a folder with the same name as the workspace
  try {
    const { files } = await api.driveList('root', workspaceLabel);
    const match = files.find(
      (f) => f.name.toLowerCase() === workspaceLabel.toLowerCase() && f.mimeType === 'application/vnd.google-apps.folder',
    );
    if (match) {
      const dest: DriveSyncDest = { id: match.id, name: match.name };
      setWorkspaceDriveDest(workspaceId, dest);
      return dest;
    }
  } catch { /* ignore */ }

  // 3. Default to a target folder named after the workspace in Drive (auto-created on upload)
  const defaultDest: DriveSyncDest = { id: `create:${workspaceLabel}`, name: workspaceLabel, isNew: true };
  setWorkspaceDriveDest(workspaceId, defaultDest);
  return defaultDest;
}

export function setWorkspaceDriveDest(workspaceId: string, dest: DriveSyncDest) {
  try {
    localStorage.setItem(`rs.driveSyncDest.${workspaceId}`, JSON.stringify(dest));
  } catch { /* ignore */ }
}

let syncInFlight = false;

/** Runs background scan and comparison with Drive without blocking user interactions. */
export async function runWorkspaceDriveSync(destOverride?: DriveSyncDest): Promise<void> {
  const ws = useWorkspace.getState();
  const provider = ws.provider;
  if (!provider || !['fsa', 'fallback', 'sample'].includes(provider.kind)) return;

  const auth = useAuth.getState();
  if (auth.drive.status !== 'connected') return;

  if (syncInFlight) return;
  syncInFlight = true;
  ws.setIsSyncScanning(true);

  try {
    let dest: DriveSyncDest;
    if (destOverride) {
      dest = destOverride;
      setWorkspaceDriveDest(provider.id, dest);
    } else {
      dest = await getOrResolveDriveDest(provider.id, provider.label);
    }

    const paths = await ws.walkAll();
    const slice = paths.slice(0, 1000);
    const manifest: Candidate[] = [];
    const entries = ws.entries;
    const batchSize = 50;

    for (let i = 0; i < slice.length; i += batchSize) {
      const batch = slice.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (p) => {
          try {
            let size: number | undefined;
            if (provider && 'stat' in provider && typeof (provider as any).stat === 'function') {
              const s = await (provider as any).stat(p.path);
              size = s.size;
            } else {
              const dir = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '';
              const cachedEntry = (entries[dir] ?? []).find((e) => e.path === p.path);
              size = cachedEntry?.size;
              if (size === undefined) {
                const buf = await provider.readFile(p.path);
                size = buf.byteLength;
              }
            }
            return {
              relativePath: p.path,
              name: p.path.split('/').pop() ?? p.path,
              size: size ?? 0,
              classification: 'likely_new' as const,
            };
          } catch {
            return {
              relativePath: p.path,
              name: p.path.split('/').pop() ?? p.path,
              classification: 'unreadable' as const,
            };
          }
        }),
      );
      manifest.push(...batchResults);
    }

    const res = await api.transfersScan(dest.id, manifest);
    const statusByPath: Record<string, Candidate['classification']> = {};
    for (const c of res.candidates) {
      statusByPath[c.relativePath] = c.classification;
    }
    const newCount = res.candidates.filter((c) => c.classification === 'likely_new').length;
    const sameCount = res.candidates.filter((c) => c.classification === 'same_candidate').length;
    const modCount = res.candidates.filter((c) => c.classification === 'name_collision').length;

    useWorkspace.getState().setCloudSync({
      destId: dest.id,
      destName: dest.name,
      remoteCount: res.remoteCount,
      candidates: res.candidates,
      statusByPath,
      newCount,
      sameCount,
      modCount,
      scannedAt: Date.now(),
    });
  } catch (err) {
    console.warn('[autoSync] background drive sync error:', err);
  } finally {
    syncInFlight = false;
    useWorkspace.getState().setIsSyncScanning(false);
  }
}
