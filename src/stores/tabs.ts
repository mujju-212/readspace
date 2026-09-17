import { create } from 'zustand';
import { basename, extOf } from '../services/fs/types';
import type { RendererId } from '../services/fs/types';
import { confirmDialog } from './confirm';

export type ViewMode = 'preview' | 'edit' | 'split';

export interface Tab {
  id: string;
  path: string;
  title: string;
  ext: string;
  mode: ViewMode;
  forceText: boolean;
  dirty: boolean;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** open a file: reuses its tab if one exists, otherwise ALWAYS adds a new tab */
  openPath: (path: string, opts?: { ext?: string }) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeAll: () => void;
  closeOthers: (id: string) => void;
  next: (delta: number) => void;
  setMode: (id: string, mode: ViewMode) => void;
  setDirty: (id: string, dirty: boolean) => void;
  setForceText: (id: string, v: boolean) => void;
  reorder: (from: number, to: number) => void;
  restore: (tabs: Array<Partial<Tab> & { path: string }>, activePath: string | null) => void;
}

let seq = 0;
const nextId = () => `tab-${Date.now().toString(36)}-${seq++}`;

function makeTab(path: string, ext: string): Tab {
  return {
    id: nextId(),
    path,
    title: basename(path),
    ext: ext || extOf(path),
    mode: 'preview',
    forceText: false,
    dirty: false,
  };
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,

  openPath: (path, opts = {}) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rs:close-home'));
    // same file → just activate its existing tab (never duplicate, never replace)
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    // every new file gets its own persistent tab in the nav
    const tab = makeTab(path, opts.ext ?? '');
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  activate: (id) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rs:close-home'));
    set((s) => (s.tabs.some((t) => t.id === id) ? { activeId: id } : s));
  },

  close: async (id) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty && !(await confirmDialog(`"${tab.title}" has unsaved changes.\nClose without saving?`, 'Discard and close'))) {
      return;
    }
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeId = s.activeId;
    if (s.activeId === id) {
      const next = tabs[idx] ?? tabs[idx - 1] ?? null;
      activeId = next ? next.id : null;
    }
    set({ tabs, activeId });
  },

  closeAll: async () => {
    const dirty = get().tabs.filter((t) => t.dirty);
    if (dirty.length > 0 && !(await confirmDialog(`${dirty.length} tab(s) have unsaved changes.\nClose all without saving?`, 'Discard and close all'))) {
      return;
    }
    set({ tabs: [], activeId: null });
  },

  closeOthers: async (id) => {
    const s = get();
    const dirty = s.tabs.filter((t) => t.dirty && t.id !== id);
    if (dirty.length > 0 && !(await confirmDialog(`${dirty.length} other tab(s) have unsaved changes.\nClose them without saving?`, 'Discard and close'))) {
      return;
    }
    const keep = s.tabs.find((t) => t.id === id);
    if (keep) set({ tabs: [keep], activeId: keep.id });
  },

  next: (delta) => {
    const s = get();
    if (s.tabs.length === 0) return;
    const idx = Math.max(0, s.tabs.findIndex((t) => t.id === s.activeId));
    const nextIdx = (idx + delta + s.tabs.length) % s.tabs.length;
    set({ activeId: s.tabs[nextIdx].id });
  },

  setMode: (id, mode) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, mode } : t)) })),

  setDirty: (id, dirty) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) })),

  setForceText: (id, v) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, forceText: v, mode: 'preview' } : t)) })),

  reorder: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return s;
      tabs.splice(to, 0, moved);
      return { tabs };
    }),

  restore: (restored, activePath) => {
    const tabs = restored
      .filter((t) => t.path)
      .map((t) => ({ ...makeTab(t.path, t.ext ?? ''), mode: (t.mode as ViewMode) ?? 'preview', forceText: t.forceText ?? false }));
    const active = tabs.find((t) => t.path === activePath) ?? tabs[tabs.length - 1];
    set({ tabs, activeId: active ? active.id : null });
  },
}));

/* ---------- per-workspace session persistence (FR-50) ---------- */

export interface SessionData {
  tabs: Array<{ path: string; ext: string; mode: ViewMode; forceText: boolean }>;
  activePath: string | null;
}

export function saveSession(providerId: string, tabs: Tab[], activePath: string | null): void {
  try {
    const data: SessionData = {
      tabs: tabs.map((t) => ({ path: t.path, ext: t.ext, mode: t.mode, forceText: t.forceText })),
      activePath,
    };
    localStorage.setItem(`rs.session.${providerId}`, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function loadSession(providerId: string): SessionData | null {
  try {
    const raw = localStorage.getItem(`rs.session.${providerId}`);
    return raw ? (JSON.parse(raw) as SessionData) : null;
  } catch {
    return null;
  }
}

export { type RendererId };
