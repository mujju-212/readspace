import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings, applyTheme, FONT_FAMILIES } from './stores/settings';
import { useWorkspace } from './stores/workspace';
import { useTabs, saveSession } from './stores/tabs';
import { kvGet, getHandle } from './services/persistence';
import { TitleBar } from './components/TitleBar';
import { Explorer } from './components/Explorer';
import { TabBar } from './components/TabBar';
import { ViewerHost } from './components/ViewerHost';
import { StatusBar } from './components/StatusBar';
import { Welcome, EmptyTabs } from './components/viewers/Welcome';
import { QuickOpen } from './components/QuickOpen';
import { DriveDialog } from './components/DriveDialog';
import { Toasts } from './components/Toasts';
import { ConfirmHost } from './components/ConfirmHost';
import { AccountMenu, CloudMenu } from './components/AccountMenu';
import { CloudDialogs, TransferPanel } from './components/cloud/DriveDialogs';
import { BottomNav } from './components/BottomNav';
import { AuthModal } from './components/auth/AuthModal';
import { AccountSecurityModal } from './components/auth/AccountSecurityModal';
import { useAuth } from './stores/auth';
import { api } from './services/api';
import { CloudDriveProvider } from './services/fs/cloud';
import { syncSavedProgress } from './features/cloud/saved';
import { getScrollFor } from './components/ViewerHost';
import { BackgroundAudioBar } from './components/viewers/BackgroundAudioBar';

export default function App() {
  const theme = useSettings((s) => s.theme);
  const font = useSettings((s) => s.font);
  const fontSize = useSettings((s) => s.fontSize);
  const lineHeight = useSettings((s) => s.lineHeight);
  const contentWidth = useSettings((s) => s.contentWidth);
  const sidebarVisible = useSettings((s) => s.sidebarVisible);
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  const zen = useSettings((s) => s.zen);
  // responsive shell (PRD v1.3 §21): mobile = drawer + bottom nav
  const [isMobile, setIsMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 700px)');
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [homeOpen, setHomeOpen] = useState(false);
  const set = useSettings((s) => s.set);

  const provider = useWorkspace((s) => s.provider);
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  const [quickOpen, setQuickOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const openDrive = useCallback(() => setDriveOpen(true), []);
  const [pendingReconnect, setPendingReconnect] = useState<{ label: string; handle: FileSystemDirectoryHandle } | null>(null);
  const [dragging, setDragging] = useState(false);
  const install = useCallback((p: any) => useWorkspace.getState().installProvider(p), []);

  /* ---------- theme + reader typography ---------- */
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty('--reader-font', FONT_FAMILIES[font]);
    s.setProperty('--reader-size', `${fontSize}px`);
    s.setProperty('--reader-line', String(lineHeight));
    s.setProperty('--reader-width', `${contentWidth}px`);
  }, [font, fontSize, lineHeight, contentWidth]);

  const providerId = useWorkspace((s) => s.provider?.id);
  useEffect(() => { if (provider) setHomeOpen(false); }, [provider]);
  useEffect(() => { if (activeId) setHomeOpen(false); }, [activeId]);
  useEffect(() => {
    const onDismissHome = () => setHomeOpen(false);
    window.addEventListener('rs:close-home', onDismissHome);
    return () => window.removeEventListener('rs:close-home', onDismissHome);
  }, []);

  // app-like mobile: a workspace opens on the reader; the drawer is opt-in via Files
  useEffect(() => {
    if (providerId && isMobile) set({ sidebarVisible: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, isMobile]);

  /* ---------- global events from Home / BottomNav ---------- */
  useEffect(() => {
    const onQO = () => {
      if (useWorkspace.getState().provider) setQuickOpen(true);
    };
    window.addEventListener('rs:quick-open', onQO);
    return () => window.removeEventListener('rs:quick-open', onQO);
  }, []);

  /* ---------- bootstrap: restore last workspace (FR-50) ---------- */
  useEffect(() => {
    void (async () => {
      try {
        await useAuth.getState().bootstrap();
        // returning from the OAuth redirect with ?drive=1 → open Drive right away
        const params = new URLSearchParams(window.location.search);
        const wantsDrive = params.get('drive') === '1';
        if (wantsDrive) {
          window.history.replaceState({}, '', window.location.pathname);
          const { user, drive } = useAuth.getState();
          if (user && drive.status === 'connected') {
            await install(new CloudDriveProvider('root'));
            return;
          }
        }
        let last = await kvGet<{ kind: string; label?: string; rootId?: string; hint?: string }>('last');
        if (!last) {
          const { getRecents } = await import('./services/persistence');
          const recents = await getRecents();
          if (recents.length > 0) {
            const r = recents[0];
            last = { kind: r.kind, label: r.label, rootId: r.id, hint: r.hint };
          }
        }
        if (!last) return;
        if (last.kind === 'clouddrive' && last.rootId) {
          const { user, drive } = useAuth.getState();
          if (user && drive.status === 'connected') {
            await install(new CloudDriveProvider(last.rootId, last.label));
            return;
          }
        }
        if (last.kind === 'sample') {
          const { loadSample } = await import('./services/fs/open');
          await install(await loadSample());
        } else if (last.kind === 'cloudlink' && last.rootId) {
          // a saved link was the last workspace — reopen it if still accessible
          const { user, drive } = useAuth.getState();
          if (user && drive.status === 'connected') {
            const { openSavedLinkById } = await import('./features/cloud/saved');
            void openSavedLinkById(last.rootId).catch(() => undefined);
          }
        } else if (last.kind === 'gdrive' && last.rootId) {
          const { storedDriveKey, createGDriveProvider } = await import('./services/fs/gdrive');
          const key = storedDriveKey();
          if (key) {
            try {
              await install(await createGDriveProvider(last.rootId, key));
            } catch { /* stale key/link — fall through to the welcome screen */ }
          }
        } else if (last.kind === 'gdrivefile' && last.rootId && last.hint) {
          const { createGDriveKeyless } = await import('./services/fs/gdrive');
          try {
            await install(await createGDriveKeyless(last.rootId, last.hint as 'gdoc' | 'gsheet' | 'gppt'));
          } catch { /* stale/unshared link — fall through to the welcome screen */ }
        } else if (last.kind === 'fsa') {
          let handle = last.label ? await getHandle<FileSystemDirectoryHandle>(last.label) : null;
          if (!handle) handle = await getHandle<FileSystemDirectoryHandle>('last');
          if (!handle) return;
          const { FsaProvider } = await import('./services/fs/fsa');
          const p = new FsaProvider(handle);
          const perm = handle as unknown as { queryPermission?: (d: object) => Promise<PermissionState> };
          let state: PermissionState = 'prompt';
          try {
            state = (await perm.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
            if (state !== 'granted') {
              state = (await perm.queryPermission?.({ mode: 'read' })) ?? 'prompt';
            }
          } catch {
            state = 'prompt';
          }

          if (state === 'granted') {
            await install(p);
          } else {
            // Permission needed! First check if cached snapshot exists so the tree renders immediately
            const { getSnapshot } = await import('./services/persistence');
            let snapshot = last.label ? await getSnapshot(last.label) : null;
            if (!snapshot || snapshot.length === 0) snapshot = await getSnapshot(`fsa:${last.label}`);
            if (!snapshot || snapshot.length === 0) snapshot = await getSnapshot('last');
            if (snapshot && snapshot.length > 0) {
              const { FallbackProvider } = await import('./services/fs/fallback');
              const extraDirs: string[] = [];
              const files: File[] = [];
              for (const s of snapshot) {
                if (s.isDir) {
                  extraDirs.push(s.path);
                } else {
                  const f = new File([s.buffer], s.name, { type: s.type });
                  Object.defineProperty(f, 'webkitRelativePath', {
                    value: `${last.label || 'folder'}/${s.path.replace(/\\/g, '/').replace(/^\/+/, '')}`,
                  });
                  files.push(f);
                }
              }
              await install(new FallbackProvider(files, extraDirs));
            } else {
              await install(p);
            }
            setPendingReconnect({ label: p.label, handle });
          }
        } else if (last.kind === 'fallback') {
          const { getSnapshot } = await import('./services/persistence');
          let snapshot = last.label ? await getSnapshot(last.label) : null;
          if (!snapshot || snapshot.length === 0) snapshot = await getSnapshot('last');
          if (snapshot && snapshot.length > 0) {
            const { FallbackProvider } = await import('./services/fs/fallback');
            const extraDirs: string[] = [];
            const files: File[] = [];
            for (const s of snapshot) {
              if (s.isDir) {
                extraDirs.push(s.path);
              } else {
                const f = new File([s.buffer], s.name, { type: s.type });
                Object.defineProperty(f, 'webkitRelativePath', {
                  value: `${last.label || 'folder'}/${s.path.replace(/\\/g, '/').replace(/^\/+/, '')}`,
                });
                files.push(f);
              }
            }
            await install(new FallbackProvider(files, extraDirs));
          }
        }
      } catch (err) {
        console.warn('[App] bootstrap restore error:', err);
      }
    })();
  }, [install]);

  /* ---------- persist open tabs per workspace (device) ---------- */
  useEffect(() => {
    if (!provider) return;
    const t = setTimeout(() => saveSession(provider.id, tabs, activeTab?.path ?? null), 250);
    return () => clearTimeout(t);
  }, [provider, tabs, activeTab]);

  /* ---------- persist open tabs to the account (cross-device, SYNC-02/03) ---------- */
  const user = useAuth((s) => s.user);
  useEffect(() => {
    if (!user || !provider) return;
    const t = setTimeout(() => {
      void api.workspaceSync({
        key: provider.id,
        displayName: provider.label,
        provider: provider.kind === 'clouddrive' ? 'google_drive' : 'local',
        rootDriveFolderId: provider instanceof CloudDriveProvider ? provider.rootId : undefined,
        session: {
          openTabs: tabs.map((tab) => ({
            resourceKey: `${provider.id}::${tab.path}`,
            title: tab.title,
            pinned: false,
            isPreviewTab: false,
            scrollTop: getScrollFor(tab.path),
          })),
          activeResourceKey: activeTab ? `${provider.id}::${activeTab.path}` : undefined,
          layout: { theme: useSettings.getState().theme, sidebarWidth: useSettings.getState().sidebarWidth },
        },
      }).catch(() => undefined);
      // reading progress for saved links (PRD §9: optional progress + last-opened)
      if (activeTab && (provider.kind === 'clouddrive' || provider.kind === 'cloudlink')) {
        const fileId = provider.kind === 'clouddrive'
          ? (provider as CloudDriveProvider).fileIdFor(activeTab.path)
          : (provider as { fileIdFor?: (p: string) => string | undefined }).fileIdFor?.(activeTab.path);
        if (fileId) syncSavedProgress(provider.kind, fileId, getScrollFor(activeTab.path) ?? 0);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [user, provider, tabs, activeTab]);

  /* ---------- warn before leaving with unsaved edits ---------- */
  useEffect(() => {
    const dirty = tabs.some((t) => t.dirty);
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [tabs]);

  /* ---------- global shortcuts (FR-16, FR-41, FR-45, FR-51) ---------- */
  const closeActive = useCallback(() => {
    const s = useTabs.getState();
    if (s.activeId) s.close(s.activeId);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const s = useSettings.getState();
        s.set({ sidebarVisible: !s.sidebarVisible });
      } else if (key === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setQuickOpen(true);
      } else if (key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        closeActive();
      } else if (e.key === 'Tab' && !e.altKey) {
        e.preventDefault();
        useTabs.getState().next(e.shiftKey ? -1 : 1);
      } else if (key === 'z' && e.altKey) {
        e.preventDefault();
        const s = useSettings.getState();
        s.set({ zen: !s.zen, sidebarVisible: s.zen });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeActive]);

  /* ---------- sidebar resizing (FR-40) ---------- */
  const dividerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startW: number } | null>(null);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startW: sidebarWidth };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const w = dragState.current.startW + (e.clientX - dragState.current.startX);
      useSettings.getState().set({ sidebarWidth: Math.min(520, Math.max(170, w)) });
    };
    const onUp = () => {
      dragState.current = null;
      setDragging(false);
    };
    const onDblClickReset = () => useSettings.getState().set({ sidebarWidth: 260 });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dividerRef.current?.addEventListener('dblclick', onDblClickReset);
    document.body.classList.add('dragging-divider');
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dividerRef.current?.removeEventListener('dblclick', onDblClickReset);
      document.body.classList.remove('dragging-divider');
    };
  }, [dragging]);

  return (
    <div className={`app${dragging ? ' dragging' : ''}`}>
      <TitleBar onQuickOpen={() => setQuickOpen(true)} onOpenDrive={openDrive} onHome={() => setHomeOpen(true)} />

      {pendingReconnect && (
        <div className="reconnect-banner" role="alert">
          <span className="reconnect-msg">📂 <b>Workspace access:</b> Click “Grant Access” to allow ReadSpace to read files in “{pendingReconnect.label}”.</span>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={async () => {
              const { reconnectFsa } = await import('./services/fs/open');
              const p = await reconnectFsa(pendingReconnect.handle);
              if (p) {
                setPendingReconnect(null);
                await install(p);
                void useWorkspace.getState().refreshRoot();
              }
            }}
          >
            Grant Access
          </button>
        </div>
      )}

      <div className="workbench">
        {provider && sidebarVisible && !zen && (
          <>
            <aside className={`sidebar${isMobile ? ' drawer' : ''}`} style={isMobile ? undefined : { width: sidebarWidth }} aria-label="File explorer">
              <Explorer />
            </aside>
            {isMobile && (
              <button
                type="button"
                className="drawer-scrim"
                aria-label="Close file explorer"
                onClick={() => set({ sidebarVisible: false })}
              />
            )}
            {!isMobile && (
              <div
                ref={dividerRef}
                className="divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar (drag; double-click to reset)"
                title="Drag to resize · double-click to reset"
                onMouseDown={onDividerMouseDown}
              />
            )}
          </>
        )}

        <main className="main">
          {!zen && !homeOpen && <TabBar />}
          <div className="content">
            {homeOpen || !provider ? (
              <Welcome pendingReconnect={pendingReconnect} onOpenDrive={openDrive} />
            ) : activeTab ? (
              <ViewerHost key={activeTab.id} tab={activeTab} />
            ) : (
              <EmptyTabs />
            )}
          </div>
        </main>
      </div>

      {!zen && !isMobile && <StatusBar />}
      {isMobile && !zen && (
        <BottomNav
          home={homeOpen || !provider}
          files={!!provider && sidebarVisible && !homeOpen}
          onHome={() => setHomeOpen(true)}
          onFiles={() => set({ sidebarVisible: !sidebarVisible || homeOpen })}
        />
      )}
      {quickOpen && provider && <QuickOpen onClose={() => setQuickOpen(false)} />}
      {driveOpen && <DriveDialog onClose={() => setDriveOpen(false)} />}
      <CloudDialogs />
      <TransferPanel />
      <Toasts />
      <ConfirmHost />
      <BackgroundAudioBar />
      <AuthModal />
      <AccountSecurityModal />
    </div>
  );
}

/** install a provider into the workspace store (used by the bootstrap flow) */
async function install(p: import('./services/fs/types').FileSystemProvider) {
  await useWorkspace.getState().installProvider(p);
}
