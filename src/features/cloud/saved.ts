/**
 * Saved Links flows (PRD v1.1 §9): a personal collection of *references* to
 * shared Drive files/folders, tied to the ReadSpace account. Access always
 * follows the owner's sharing settings — saving never grants it.
 */
import { api, type SavedLink } from '../../services/api';
import { CloudLinkProvider, openCloudLink, revokedMessage } from '../../services/fs/cloudlink';
import { openGDriveKeyless } from '../../services/fs/gdrive';
import { useWorkspace } from '../../stores/workspace';
import { useAuth } from '../../stores/auth';
import { toast } from '../../stores/toast';

/** Small in-memory mirror so the session-sync loop can attach progress cheaply. */
let cache: SavedLink[] = [];

export function setSavedLinksCache(links: SavedLink[]) {
  cache = links;
}

export function savedLinksCache(): SavedLink[] {
  return cache;
}

export async function refreshSavedLinks(): Promise<SavedLink[]> {
  try {
    const { links } = await api.savedLinks();
    cache = links;
    return links;
  } catch {
    return cache;
  }
}

function isNativeDoc(link: SavedLink): boolean {
  if (link.mimeType && link.mimeType.startsWith('application/vnd.google-apps.')) return link.mimeType !== 'application/vnd.google-apps.folder';
  return /docs\.google\.com\/(document|spreadsheets|presentation)/.test(link.url);
}

/**
 * Open a saved link:
 *  - Drive connected → through the server proxy (resourceKey handled server-side).
 *  - Not connected but a Google Doc/Sheet/Slides → keyless export.
 *  - Otherwise → explain that sign-in is needed ("Access may require Google sign-in").
 */
export async function openSavedLink(link: SavedLink): Promise<boolean> {
  const { drive } = useAuth.getState();
  try {
    if (drive.status === 'connected') {
      const provider = await openCloudLink(link);
      await useWorkspace.getState().installProvider(provider);
    } else if (isNativeDoc(link)) {
      const p = await openGDriveKeyless(link.url);
      if (!p) throw new Error('Not a keyless-native link');
      await useWorkspace.getState().installProvider(p);
    } else {
      toast('Access may require Google sign-in — connect Drive to open this saved link', 'warn');
      return false;
    }
    void api.savedLinkUpdate(link._id, { markOpened: true }).then(({ link: updated }) => {
      cache = cache.map((l) => (l._id === updated._id ? updated : l));
    }).catch(() => undefined);
    return true;
  } catch (e) {
    // e.g. the owner revoked access — the reference stays, the panel stays open
    toast(revokedMessage(e), 'warn');
    return false;
  }
}

/** Restore-by-id used by the last-workspace bootstrap (kind 'cloudlink'). */
export async function openSavedLinkById(savedId: string): Promise<void> {
  const links = cache.some((l) => l._id === savedId) ? cache : await refreshSavedLinks();
  const link = links.find((l) => l._id === savedId);
  if (!link) return;
  await openSavedLink(link);
}

/** Attach reading progress for a cloud tab to its saved link, if any. */
export function syncSavedProgress(providerKind: string, fileId: string | null, scrollTop: number) {
  if (!fileId) return;
  const link = cache.find((l) => l.fileId === fileId || l.folderId === fileId);
  if (!link) return;
  void api.savedLinkUpdate(link._id, { progress: { scrollTop } })
    .then(({ link: updated }) => { cache = cache.map((l) => (l._id === updated._id ? updated : l)); })
    .catch(() => undefined);
}

export { CloudLinkProvider };
