import React, { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useSettings, applyTheme, type ThemeName } from '../stores/settings';
import { useTabs } from '../stores/tabs';
import { openFolderFlow } from '../services/fs/open';
import { Logo, PanelLeft, Maximize, Moon, Sun, Leaf, Gear, Search, Plus, Cloud } from './Icons';
import { SettingsPopover } from './SettingsPopover';
import { AccountMenu, CloudMenu } from './AccountMenu';
import { toast } from '../stores/toast';

const THEME_ORDER: ThemeName[] = ['ice', 'light', 'sepia', 'dark', 'system'];
const THEME_ICON: Record<ThemeName, React.ReactNode> = {
  ice: <Sun size={14} />,
  light: <Sun size={14} />,
  sepia: <Leaf size={14} />,
  dark: <Moon size={14} />,
  system: <Gear size={14} />,
};

/** Top bar: app identity + global actions (the "File / View / Help" strip). */
export function TitleBar({ onQuickOpen, onOpenDrive, onHome }: { onQuickOpen: () => void; onOpenDrive: () => void; onHome: () => void }) {
  const provider = useWorkspace((s) => s.provider);
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  const sidebarVisible = useSettings((s) => s.sidebarVisible);
  const zen = useSettings((s) => s.zen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => applyTheme(theme), [theme]);

  // Settings entry point from the mobile bottom nav (PRD §21)
  useEffect(() => {
    const onOpen = () => setSettingsOpen(true);
    window.addEventListener('rs:open-settings', onOpen);
    return () => window.removeEventListener('rs:open-settings', onOpen);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    set({ theme: next });
    toast(`Theme: ${next}`, 'ok');
  };

  return (
    <header className="titlebar">
      <div className="tb-left">
        {!zen && (
          <button
            type="button"
            className="icon-btn"
            title="Toggle sidebar (Ctrl+B)"
            aria-label="Toggle sidebar"
            onClick={() => set({ sidebarVisible: !sidebarVisible })}
          >
            <PanelLeft size={15} />
          </button>
        )}
        <button type="button" className="brand" onClick={onHome} title="Home" aria-label="Go to Home">
          <Logo size={18} />
          <span className="brand-name">ReadSpace</span>
        </button>
        {provider && <span className="ws-label" title={`Workspace: ${provider.id}`}>{provider.label}</span>}
      </div>

      <div className="tb-center">
        <button type="button" className="btn btn-ghost quick-open-hint" onClick={onQuickOpen} title="Quick open (Ctrl+P)">
          <Search size={13} /> Quick open… <kbd>Ctrl P</kbd>
        </button>
      </div>

      <div className="tb-right">
        <CloudMenu />
        <AccountMenu />
        <button type="button" className="btn tb-desktop-only" onClick={onOpenDrive} title="Open from Google Drive (public link)" aria-label="Open from Google Drive">
          <Cloud size={14} /> Drive
        </button>
        <button type="button" className="btn tb-desktop-only" onClick={() => void openFolderFlow().then((p) => p && useWorkspace.getState().installProvider(p))} title="Open a folder as workspace">
          <Plus size={14} /> Open Folder
        </button>
        {!zen && (
          <>
            <button type="button" className="icon-btn" title={`Theme: ${theme} (click to cycle)`} onClick={cycleTheme} aria-label="Cycle theme">
              {THEME_ICON[theme]}
            </button>
            <div className="settings-anchor" ref={popRef}>
              <button type="button" className="icon-btn" title="Reader settings" aria-label="Reader settings" onClick={() => setSettingsOpen((o) => !o)}>
                <Gear size={15} />
              </button>
              {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
            </div>
          </>
        )}
        <button
          type="button"
          title="Zen mode (Ctrl+Alt+Z)"
          className="icon-btn tb-desktop-only"
          aria-label="Toggle zen mode"
          onClick={() => set({ zen: !zen, sidebarVisible: zen ? true : false })}
        >
          <Maximize size={14} />
        </button>
      </div>
    </header>
  );
}
