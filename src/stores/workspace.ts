import { create } from 'zustand';
import type { FileSystemProvider, FsEntry } from '../services/fs/types';
import { isVisible, sortEntries } from '../services/fs/types';
import { useTabs, loadSession } from './tabs';
import { kvSet, putHandle } from '../services/persistence';

import type { Candidate } from '../services/api';

export interface CloudSyncStatus {
  destId: string;
  destName: string;
  remoteCount: number;
  candidates: Candidate[];
  statusByPath: Record<string, Candidate['classification']>;
  newCount: number;
  sameCount: number;
  modCount: number;
  scannedAt: number;
}

interface WorkspaceState {
  provider: FileSystemProvider | null;
  /** path -> children (loaded lazily, one level at a time) */
  entries: Record<string, FsEntry[] | undefined>;
  expanded: Record<string, boolean>;
  selected: string | null;
  filter: string;
  /** bumped after each successful save so views re-read the file */
  versions: Record<string, number>;
  loadingPaths: Record<string, boolean>;
  busy: boolean;
  error: string | null;
  cloudSync: CloudSyncStatus | null;
  isSyncScanning: boolean;

  installProvider: (p: FileSystemProvider) => Promise<void>;
  refreshRoot: () => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  loadChildren: (path: string) => Promise<void>;
  select: (path: string | null) => void;
  setFilter: (f: string) => void;
  bumpVersion: (path: string) => void;
  setCloudSync: (sync: CloudSyncStatus | null) => void;
  setIsSyncScanning: (val: boolean) => void;
  markCandidateUploaded: (path: string) => void;
  /** full recursive scan (filter box / quick open); cached per provider */
  walkAll: () => Promise<Array<{ path: string; ext?: string }>>;
}

let walkCache: { providerId: string; files: Array<{ path: string; ext?: string }> } | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  provider: null,
  entries: {},
  expanded: {},
  selected: null,
  filter: '',
  versions: {},
  loadingPaths: {},
  busy: false,
  error: null,
  cloudSync: null,
  isSyncScanning: false,

  setCloudSync: (sync) => set({ cloudSync: sync }),
  setIsSyncScanning: (isSyncScanning) => set({ isSyncScanning }),
  markCandidateUploaded: (path) =>
    set((s) => {
      if (!s.cloudSync) return s;
      const nextStatus = { ...s.cloudSync.statusByPath, [path]: 'same_candidate' as const };
      const candidates = s.cloudSync.candidates.map((c) =>
        c.relativePath === path ? { ...c, classification: 'same_candidate' as const, reason: 'Uploaded to Drive' } : c,
      );
      const newCount = candidates.filter((c) => c.classification === 'likely_new').length;
      const sameCount = candidates.filter((c) => c.classification === 'same_candidate').length;
      const modCount = candidates.filter((c) => c.classification === 'name_collision').length;
      return {
        cloudSync: {
          ...s.cloudSync,
          candidates,
          statusByPath: nextStatus,
          newCount,
          sameCount,
          modCount,
        },
      };
    }),

  installProvider: async (p) => {
    // remember expanded state per workspace
    let expanded: Record<string, boolean> = {};
    try { expanded = JSON.parse(localStorage.getItem(`rs.expanded.${p.id}`) ?? '{}'); } catch { /* ignore */ }
    walkCache = null;
    set({ provider: p, entries: {}, expanded, selected: null, filter: '', versions: {}, busy: true, error: null, cloudSync: null, isSyncScanning: false });
    document.title = `ReadSpace — ${p.label}`;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rs:close-home'));
    // remember the last workspace for the next visit (incl. cloud roots)
    if (p.kind === 'clouddrive') {
      void kvSet('last', { kind: 'clouddrive', rootId: p.id.slice('clouddrive:'.length), label: p.label });
    } else if (p.kind === 'fsa') {
      void kvSet('last', { kind: 'fsa', label: p.label });
      const fsaHandle = (p as unknown as { handle?: FileSystemDirectoryHandle }).handle;
      if (fsaHandle) {
        void putHandle(p.label, fsaHandle);
        void putHandle('last', fsaHandle);
        void putHandle(`fsa:${p.label}`, fsaHandle);
      }
    } else if (p.kind === 'fallback') {
      void kvSet('last', { kind: 'fallback', label: p.label });
    } else if (p.kind === 'sample') {
      void kvSet('last', { kind: 'sample', label: 'sample' });
    }
    // restore previous tabs for this workspace (FR-50 device; SYNC-03 account)
    const session = loadSession(p.id);
    if (session) {
      useTabs.getState().restore(session.tabs, session.activePath);
    } else {
      let restored = false;
      try {
        const { api } = await import('../services/api');
        const { useAuth } = await import('./auth');
        if (useAuth.getState().user) {
          const res = await api.workspaceGet(p.id);
          const tabs = res.session?.openTabs ?? [];
          if (tabs.length > 0) {
            useTabs.getState().restore(
              tabs.map((tab: { resourceKey: string; title?: string; scrollTop?: number }) => ({
                path: tab.resourceKey.includes('::') ? tab.resourceKey.split('::').slice(1).join('::') : tab.resourceKey,
                ext: '',
              })),
              res.session.activeResourceKey && res.session.activeResourceKey.includes('::')
                ? res.session.activeResourceKey.split('::').slice(1).join('::')
                : null,
            );
            restored = true;
          }
        }
      } catch { /* account unavailable — start empty */ }
      if (!restored) useTabs.getState().restore([], null);
    }
    try {
      const rootEntries = await p.listDir('');
      set((s) => ({ entries: { ...s.entries, '': rootEntries }, busy: false }));
      // a workspace that is just one file (e.g. a shared Drive file) opens right away
      if (rootEntries.length === 1 && rootEntries[0].kind === 'file') {
        useTabs.getState().openPath(rootEntries[0].path, { ext: rootEntries[0].ext });
      }
      // load children for previously-expanded folders (without toggling them shut)
      const expandedPaths = Object.keys(expanded).filter((k) => expanded[k]);
      // Sort by depth so parents load before child subfolders
      expandedPaths.sort((a, b) => a.split('/').length - b.split('/').length);
      for (const ep of expandedPaths) {
        await get().loadChildren(ep);
      }
    } catch (e) {
      set({ busy: false, error: String((e as Error).message ?? e) });
    }
  },

  refreshRoot: async () => {
    const p = get().provider;
    if (!p) return;
    try {
      const rootEntries = await p.listDir('');
      walkCache = null;
      set((s) => ({ entries: { ...s.entries, '': rootEntries }, loadingPaths: {}, error: null }));
      const expanded = get().expanded;
      const expandedPaths = Object.keys(expanded).filter((k) => expanded[k]);
      expandedPaths.sort((a, b) => a.split('/').length - b.split('/').length);
      for (const ep of expandedPaths) {
        try {
          const children = await p.listDir(ep);
          set((s) => ({ entries: { ...s.entries, [ep]: children } }));
        } catch { /* ignore */ }
      }
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    }
  },

  toggleDir: async (path) => {
    const s = get();
    const isOpen = !!s.expanded[path];
    const expanded = { ...s.expanded };
    if (isOpen) delete expanded[path]; // collapsing => forget
    else expanded[path] = true;
    try { localStorage.setItem(`rs.expanded.${s.provider!.id}`, JSON.stringify(expanded)); } catch { /* ignore */ }
    set({ expanded });
    if (!isOpen) await get().loadChildren(path);
  },

  loadChildren: async (path) => {
    const p = get().provider;
    if (!p) return;
    if (get().entries[path] !== undefined) return;
    if (get().loadingPaths[path]) return;

    set((st) => ({ loadingPaths: { ...st.loadingPaths, [path]: true } }));
    try {
      const children = await p.listDir(path);
      set((st) => {
        const lp = { ...st.loadingPaths };
        delete lp[path];
        return {
          entries: { ...st.entries, [path]: children },
          loadingPaths: lp,
        };
      });
    } catch (e) {
      set((st) => {
        const lp = { ...st.loadingPaths };
        delete lp[path];
        return {
          entries: { ...st.entries, [path]: [] },
          loadingPaths: lp,
          error: String((e as Error).message ?? e),
        };
      });
    }
  },

  select: (path) => set({ selected: path }),
  setFilter: (filter) => set({ filter }),
  bumpVersion: (path) => set((s) => ({ versions: { ...s.versions, [path]: (s.versions[path] ?? 0) + 1 } })),

  walkAll: async () => {
    const p = get().provider;
    if (!p) return [];
    if (walkCache && walkCache.providerId === p.id) return walkCache.files;
    const showHidden = useSettingsSafe();
    const files: Array<{ path: string; ext?: string }> = [];
    const queue: string[] = [''];
    let count = 0;
    while (queue.length > 0 && count < 5000) {
      const dir = queue.shift()!;
      let entries: FsEntry[];
      try {
        entries = dir === '' ? (get().entries[''] ?? (await p.listDir(''))) : (get().entries[dir] ?? (await p.listDir(dir)));
      } catch {
        continue;
      }
      if (dir !== '') set((st) => ({ entries: { ...st.entries, [dir]: entries } }));
      for (const e of entries) {
        if (!isVisible(e, showHidden)) continue;
        if (e.kind === 'directory') queue.push(e.path);
        else { files.push({ path: e.path, ext: e.ext }); count++; }
      }
    }
    walkCache = { providerId: p.id, files: [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })) };
    return walkCache.files;
  },
}));

// avoids a circular import between workspace and settings stores
function useSettingsSafe(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = localStorage.getItem('rs.settings');
    return raw ? !!(JSON.parse(raw).showHidden) : false;
  } catch {
    return false;
  }
}

export async function rememberLastWorkspace(kind: string, label: string): Promise<void> {
  await kvSet('last', { kind, label });
}
