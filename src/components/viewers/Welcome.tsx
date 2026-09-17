import React, { useEffect, useState } from 'react';
import { openFolderFlow, fsaSupported, reconnectFsa } from '../../services/fs/open';
import { getHandle, getRecents, kvSet, type RecentFolder } from '../../services/persistence';
import { storedDriveKey, createGDriveProvider, createGDriveKeyless } from '../../services/fs/gdrive';
import { useAuth } from '../../stores/auth';
import { useCloudUI } from '../../stores/cloudui';
import { refreshSavedLinks, openSavedLink } from '../../features/cloud/saved';
import type { SavedLink } from '../../services/api';
import { api } from '../../services/api';
import { CloudDriveProvider } from '../../services/fs/cloud';
import { useWorkspace } from '../../stores/workspace';
import { useTabs } from '../../stores/tabs';
import { useTransfers } from '../../stores/transfers';
import { toast } from '../../stores/toast';
import { Book, Plus, Cloud } from '../Icons';

/**
 * Home (PRD v1.1 §17 + v1.3 §22): quick actions, Continue Reading, Recent
 * Items (activity-driven) and Saved Links (user-curated) stay two separate
 * lists, Recent Workspaces, Activity and Settings — one responsive layout.
 * This is the "File open / Library" page from the concept sketch.
 */

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function ProviderBadge({ kind }: { kind: 'drive' | 'shared' | 'local' | 'demo' }) {
  const label = kind === 'drive' ? 'Google Drive' : kind === 'shared' ? 'Shared Link' : kind === 'demo' ? 'Demo' : 'Local';
  return <span className={`badge ${kind === 'drive' ? 'drive' : kind === 'shared' ? 'shared' : 'local'}`}>{label}</span>;
}

export function Welcome({ pendingReconnect, onOpenDrive }: {
  pendingReconnect: { label: string; handle: FileSystemDirectoryHandle } | null;
  onOpenDrive: () => void;
}) {
  const installProvider = useWorkspace((s) => s.installProvider);
  const [recents, setRecents] = useState<RecentFolder[]>([]);
  const user = useAuth((s) => s.user);
  const drive = useAuth((s) => s.drive);
  const [accountWorkspaces, setAccountWorkspaces] = useState<Array<{ key: string; displayName: string; provider: string; lastOpenedAt: string; tabCount: number }>>([]);
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const openCloudDialog = useCloudUI((s) => s.open);
  const jobs = useTransfers((s) => s.jobs);

  useEffect(() => {
    void getRecents().then((r) => setRecents(r.slice(0, 6)));
  }, []);

  useEffect(() => {
    if (!user) { setSavedLinks([]); return; }
    void refreshSavedLinks().then(setSavedLinks);
  }, [user]);

  useEffect(() => {
    if (!user) { setAccountWorkspaces([]); return; }
    void api.workspaces().then((res) => {
      setAccountWorkspaces((res.workspaces ?? []).slice(0, 5).map((w) => ({
        key: w.key, displayName: w.displayName, provider: w.provider, lastOpenedAt: w.lastOpenedAt,
        tabCount: w.session?.openTabs?.length ?? 0,
      })));
    }).catch(() => undefined);
  }, [user]);

  const onOpenFolder = async () => {
    const p = await openFolderFlow();
    if (p) void installProvider(p);
  };

  const onReconnect = async (label: string, handle: FileSystemDirectoryHandle) => {
    const p = await reconnectFsa(handle);
    if (p) void installProvider(p);
    else toast(`Couldn't restore access to "${label}" — pick the folder again.`, 'warn');
  };

  const openSample = () => {
    void import('../../services/fs/open').then(({ loadSample }) => loadSample().then((p) => installProvider(p)));
  };

  const openDriveWorkspace = (rootId = 'root', label?: string) =>
    void installProvider(new CloudDriveProvider(rootId, label));

  const restoreRecent = (r: RecentFolder) => {
    if (r.kind === 'sample') return openSample();
    if (r.kind === 'gdrive' && r.id) {
      const hint = r.hint as 'gdoc' | 'gsheet' | 'gppt' | 'folder' | undefined;
      if (hint && hint !== 'folder') {
        void createGDriveKeyless(r.id, hint).then((p) => installProvider(p)).catch((e) => toast(String((e as Error).message ?? e), 'warn'));
      } else {
        const key = storedDriveKey();
        if (!key) { toast('Add your Google API key first — use the Drive button in the title bar.', 'warn'); return; }
        void createGDriveProvider(r.id, key).then((p) => installProvider(p)).catch((e) => toast(String((e as Error).message ?? e), 'warn'));
      }
      return;
    }
    if (r.kind === 'fsa') {
      void (async () => {
        let h = await getHandle<FileSystemDirectoryHandle>(r.label);
        if (!h) h = await getHandle<FileSystemDirectoryHandle>('last');
        if (h) {
          const { FsaProvider } = await import('../../services/fs/fsa');
          await installProvider(new FsaProvider(h));
          const p = await reconnectFsa(h);
          if (p) {
            void useWorkspace.getState().refreshRoot();
            toast(`Reconnected “${r.label}”`, 'ok');
          }
          return;
        }
        toast(`Opening “${r.label}” — please select the folder`, 'info');
        void openFolderFlow().then((p) => p && installProvider(p));
      })();
      return;
    }
    if (r.kind === 'fallback') {
      void (async () => {
        const { getSnapshot } = await import('../../services/persistence');
        const snapshot = await getSnapshot(r.label);
        if (snapshot && snapshot.length > 0) {
          const { FallbackProvider } = await import('../../services/fs/fallback');
          const extraDirs: string[] = [];
          const files: File[] = [];
          for (const s of snapshot) {
            if (s.isDir) {
              extraDirs.push(s.path);
            } else {
              const f = new File([s.buffer], s.name, { type: s.type });
              Object.defineProperty(f, 'webkitRelativePath', {
                value: `${r.label}/${s.path.replace(/\\/g, '/').replace(/^\/+/, '')}`,
              });
              files.push(f);
            }
          }
          await installProvider(new FallbackProvider(files, extraDirs));
          toast(`Restored “${r.label}”`, 'ok');
          return;
        }
        toast(`Re-opening “${r.label}” — please select the folder`, 'info');
        const p = await openFolderFlow();
        if (p) installProvider(p);
      })();
      return;
    }
    void openFolderFlow().then((p) => p && installProvider(p));
  };

  // Continue Reading = things with reading progress or a recently opened stamp
  const continueReading: Array<{ key: string; title: string; sub: string; badge: 'drive' | 'shared' | 'local' | 'demo'; progress?: number; go: () => void }> = [];
  for (const l of savedLinks) {
    if (!l.lastOpenedAt && !l.progress?.scrollTop) continue;
    continueReading.push({
      key: l._id,
      title: l.title,
      sub: `${timeAgo(l.lastOpenedAt)}${l.progress?.scrollTop ? ' · progress saved' : ''}`,
      badge: 'shared',
      progress: l.progress?.scrollTop ? Math.min(96, 8 + Math.log2(1 + l.progress.scrollTop) * 9) : undefined,
      go: () => void openSavedLink(l),
    });
  }
  for (const w of accountWorkspaces) {
    if (w.provider !== 'google_drive') continue;
    continueReading.push({
      key: w.key,
      title: w.displayName,
      sub: `${timeAgo(w.lastOpenedAt)}${w.tabCount ? ` · ${w.tabCount} tab(s)` : ''}`,
      badge: 'drive',
      go: () => openDriveWorkspace(w.key.startsWith('clouddrive:') ? w.key.slice('clouddrive:'.length) : 'root', w.displayName),
    });
  }

  const searchGo = () => {
    if (useWorkspace.getState().provider) window.dispatchEvent(new CustomEvent('rs:quick-open'));
    else toast('Open a workspace first — then Ctrl+P finds any file in it.', 'info');
  };

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-hero">
          <div className="home-logo"><Book size={24} /></div>
          <div>
            <h1 className="home-title">ReadSpace</h1>
            <p className="home-tag">One calm workspace for your notes, PDFs and documents{user ? ` — signed in as ${user.email}` : ''}.</p>
          </div>
          <div className="home-search" role="search" onClick={searchGo}>
            <span aria-hidden>⌕</span>
            <input
              placeholder="Search files in the open workspace…"
              aria-label="Search files"
              onFocus={searchGo}
              onKeyDown={(e) => { if (e.key === 'Enter') searchGo(); }}
              readOnly={!useWorkspace.getState().provider}
            />
            <kbd>Ctrl P</kbd>
          </div>
        </header>

        {pendingReconnect && (
          <section className="home-section">
            <h2>Restore last session</h2>
            <button type="button" className="btn btn-primary" onClick={() => void onReconnect(pendingReconnect.label, pendingReconnect.handle)}>
              Reconnect “{pendingReconnect.label}”
            </button>
          </section>
        )}

        <section className="home-section" aria-label="Quick actions">
          <div className="qa-grid">
            <button type="button" className="qa-card" onClick={() => void onOpenFolder()}>
              <span className="qa-icon"><Plus size={16} /></span>
              <span className="qa-name">Local Files</span>
              <span className="qa-desc">Open a folder from this device{fsaSupported() ? ' with read & write' : ' (read-only in this browser)'}.</span>
            </button>
            <button
              type="button"
              className="qa-card"
              onClick={() => {
                if (drive.status === 'connected') openDriveWorkspace('root');
                else if (user) onOpenDrive();
                else toast('Sign in first — then connect your Google Drive.', 'info');
              }}
            >
              <span className="qa-icon"><Cloud size={16} /></span>
              <span className="qa-name">Google Drive</span>
              <span className="qa-desc">{drive.status === 'connected' ? 'Browse your connected Drive.' : user ? 'Connect Drive to browse your files.' : 'Sign in to connect your Drive.'}</span>
            </button>
            <button type="button" className="qa-card" onClick={onOpenDrive}>
              <span className="qa-icon">🔗</span>
              <span className="qa-name">Open Link</span>
              <span className="qa-desc">Paste a shared Drive URL — a file or a whole folder.</span>
            </button>
            <button
              type="button"
              className="qa-card"
              onClick={() => {
                if (user) onOpenDrive();
                else toast('Sign in to keep saved links in your account.', 'info');
              }}
            >
              <span className="qa-icon">🔖</span>
              <span className="qa-name">Save Link</span>
              <span className="qa-desc">Bookmark a shared link to your collection for later.</span>
            </button>
          </div>
          <div className="home-hero-actions">
            <button type="button" className="btn" onClick={openSample}>Try the sample workspace</button>
            <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent('rs:open-settings'))}>Settings</button>
          </div>
        </section>

        <section className="home-section" aria-label="Continue reading">
          <h2>Continue Reading</h2>
          {continueReading.length === 0 ? (
            <div className="home-empty">Nothing in progress yet. Open a document — your place is remembered here.</div>
          ) : (
            <div className="cr-row">
              {continueReading.slice(0, 8).map((c) => (
                <button key={c.key} type="button" className="cr-card" onClick={c.go}>
                  <span className="cr-top">
                    <ProviderBadge kind={c.badge} />
                    <span className="cr-name">{c.title}</span>
                  </span>
                  {c.progress != null && <span className="cr-progress"><span style={{ width: `${c.progress}%` }} /></span>}
                  <span className="pl-sub">{c.sub}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="home-cols">
          <section className="home-section" aria-label="Recent items" style={{ marginTop: 0 }}>
            <h2>Recent Items</h2>
            {recents.length === 0 ? (
              <div className="home-empty">No recent activity yet — open a folder or a link to get started.</div>
            ) : (
              <div className="panel-list">
                {recents.map((r) => (
                  <button key={`${r.kind}:${r.label}`} type="button" className="pl-item" onClick={() => restoreRecent(r)}>
                    <ProviderBadge kind={r.kind === 'gdrive' ? 'drive' : r.kind === 'sample' ? 'demo' : 'local'} />
                    <span className="pl-main">
                      <span className="pl-name">{r.label}</span>
                      <span className="pl-sub">{r.kind === 'sample' ? 'Demo workspace' : r.kind === 'gdrive' ? 'Google Drive' : r.kind === 'fsa' ? 'Local folder' : 'Read-only snapshot'}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="home-section" aria-label="Saved links" style={{ marginTop: 0 }}>
            <h2>Saved Links</h2>
            {!user ? (
              <div className="home-empty">A personal collection of shared files and folders. Sign in to keep saved links in your account.</div>
            ) : savedLinks.length === 0 ? (
              <div className="home-empty">
                Nothing saved yet. Paste a Drive link (Open Link) and choose <b>Save link</b> — ReadSpace keeps a reference, never a copy.
              </div>
            ) : (
              <div className="panel-list">
                {savedLinks.slice(0, 4).map((l) => (
                  <button key={l._id} type="button" className="pl-item" title={l.url} onClick={() => void openSavedLink(l)}>
                    <ProviderBadge kind="shared" />
                    <span className="pl-main">
                      <span className="pl-name">{l.title}</span>
                      <span className="pl-sub">
                        {l.resourceType === 'folder' ? 'Drive folder · External link' : 'Drive · Shared link'}{l.collection ? ` · ${l.collection}` : ''}
                        {drive.status !== 'connected' ? ' · Access may require Google sign-in' : ''}
                      </span>
                    </span>
                  </button>
                ))}
                <button type="button" className="btn" onClick={() => openCloudDialog({ type: 'saved-links' })}>
                  View all saved links{savedLinks.length > 4 ? ` (${savedLinks.length})` : ''}
                </button>
              </div>
            )}
          </section>
        </div>

        {user && accountWorkspaces.length > 0 && (
          <section className="home-section" aria-label="Recent workspaces">
            <h2>Recent Workspaces</h2>
            <div className="panel-list">
              {accountWorkspaces.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  className="pl-item"
                  onClick={() => {
                    if (w.provider === 'google_drive') {
                      openDriveWorkspace(w.key.startsWith('clouddrive:') ? w.key.slice('clouddrive:'.length) : 'root', w.displayName);
                    } else {
                      void (async () => {
                        let h = await getHandle<FileSystemDirectoryHandle>(w.displayName);
                        if (!h) h = await getHandle<FileSystemDirectoryHandle>('last');
                        if (h) {
                          const { FsaProvider } = await import('../../services/fs/fsa');
                          await installProvider(new FsaProvider(h));
                          const p = await reconnectFsa(h);
                          if (p) {
                            void useWorkspace.getState().refreshRoot();
                            toast(`Reconnected “${w.displayName}”`, 'ok');
                          }
                          return;
                        }
                        const { getSnapshot } = await import('../../services/persistence');
                        let snapshot = await getSnapshot(w.displayName);
                        if (!snapshot || snapshot.length === 0) snapshot = await getSnapshot('last');
                        if (snapshot && snapshot.length > 0) {
                          const { FallbackProvider } = await import('../../services/fs/fallback');
                          const files = snapshot.map((s) => {
                            const f = new File([s.buffer], s.name, { type: s.type });
                            Object.defineProperty(f, 'webkitRelativePath', { value: `${w.displayName}/${s.path}` });
                            return f;
                          });
                          await installProvider(new FallbackProvider(files));
                          toast(`Restored “${w.displayName}”`, 'ok');
                          return;
                        }
                        toast(`Re-opening “${w.displayName}” — please select the folder`, 'info');
                        void onOpenFolder();
                      })();
                    }
                  }}
                >
                  <ProviderBadge kind={w.provider === 'google_drive' ? 'drive' : 'local'} />
                  <span className="pl-main">
                    <span className="pl-name">{w.displayName}{w.tabCount > 0 ? ` · ${w.tabCount} tab(s)` : ''}</span>
                    <span className="pl-sub">Last opened {timeAgo(w.lastOpenedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="home-section" aria-label="Activity">
          <h2>Activity</h2>
          {jobs.length === 0 ? (
            <div className="home-empty">Uploads and downloads you start will show up here with their status.</div>
          ) : (
            <div className="panel-list">
              {jobs.slice(0, 4).map((j) => (
                <div key={j.id} className="pl-item">
                  <ProviderBadge kind="drive" />
                  <span className="pl-main">
                    <span className="pl-name">{j.title}</span>
                    <span className="pl-sub">{j.items.length} file(s) · {j.status}{j.fallbackDownload ? ' · browser saves' : ''}</span>
                  </span>
                  <span className="badge" style={{ color: j.status === 'succeeded' ? 'var(--ok)' : j.status === 'failed' ? 'var(--err)' : 'var(--muted)' }}>{j.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="home-section welcome-tips" aria-label="Keyboard shortcuts">
          <h2>Keyboard</h2>
          <ul className="tips">
            <li><kbd>Ctrl</kbd>+<kbd>P</kbd> quick open file</li>
            <li><kbd>Ctrl</kbd>+<kbd>B</kbd> toggle sidebar</li>
            <li><kbd>Ctrl</kbd>+<kbd>S</kbd> save edits</li>
            <li><kbd>Ctrl</kbd>+<kbd>W</kbd> close tab</li>
            <li><kbd>Ctrl</kbd>+<kbd>Tab</kbd> next tab</li>
            <li><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd> zen mode</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

/** Shown when a workspace is open but no file has been opened yet. */
export function EmptyTabs() {
  const provider = useWorkspace((s) => s.provider);
  const openPath = useTabs((s) => s.openPath);
  return (
    <div className="empty-state">
      <div className="empty-icon">📖</div>
      <h2>No file open</h2>
      <p className="muted">
        Click a file in the <b>{provider?.label}</b> sidebar to read it here.<br />
        Single-click opens a preview tab; double-click pins it.
      </p>
      {provider?.kind === 'sample' && (
        <div className="empty-actions">
          <button type="button" className="btn btn-primary" onClick={() => openPath('README.md')}>
            Open sample README
          </button>
        </div>
      )}
    </div>
  );
}
