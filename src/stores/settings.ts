import { create } from 'zustand';

/** Theme choices (PRD v1.3 §20): Ice Blue is the default. */
export type ThemeName = 'ice' | 'light' | 'dark' | 'sepia' | 'system';
export type FontChoice = 'sans' | 'serif' | 'mono';

export const FONT_FAMILIES: Record<FontChoice, string> = {
  sans: "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
};

interface SettingsState {
  theme: ThemeName;
  font: FontChoice;
  fontSize: number;      // px
  lineHeight: number;
  contentWidth: number;  // px, max width of the reader column
  showHidden: boolean;
  zen: boolean;
  sidebarWidth: number;
  sidebarVisible: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const KEY = 'rs.settings';

function loadPersisted(): Partial<SettingsState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  theme: 'ice',
  font: 'sans',
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 820,
  showHidden: false,
  zen: false,
  sidebarWidth: 260,
  sidebarVisible: true,
  ...loadPersisted(),
  set: (patch) => {
    set(patch as Partial<SettingsState>);
    const { set: _omit, ...persisted } = get();
    try { localStorage.setItem(KEY, JSON.stringify(persisted)); } catch { /* ignore */ }
  },
}));

export function resolvedTheme(theme: ThemeName): 'ice' | 'light' | 'dark' | 'sepia' {
  if (theme !== 'system') return theme;
  // System/Auto follows the OS light/dark preference (PRD v1.3 §20)
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'ice';
}

export function applyTheme(theme: ThemeName): () => void {
  const apply = () => {
    document.documentElement.dataset.theme = resolvedTheme(theme);
  };
  apply();
  if (typeof matchMedia === 'undefined') return () => undefined;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', apply);
  return () => mq.removeEventListener('change', apply);
}
