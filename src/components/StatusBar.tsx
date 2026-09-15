import React from 'react';
import { useWorkspace } from '../stores/workspace';
import { useTabs } from '../stores/tabs';
import { rendererForExt, rendererLabel } from '../services/fs/types';
import { statsFor } from './ViewerHost';

/** Status bar (PRD §6.1): workspace · path · type · words · saved state. */
export function StatusBar() {
  const provider = useWorkspace((s) => s.provider);
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const tab = tabs.find((t) => t.id === activeId) ?? null;
  const rendererId = tab ? (tab.forceText ? 'text' : rendererForExt(tab.ext)) : null;
  const stats = statsFor(tab);

  return (
    <footer className="statusbar">
      <span className="sb-left">
        {provider ? (
          <>
            <span className="sb-strong">{provider.label}</span>
            {tab && <span className="sb-path" title={tab.path}>{tab.path}</span>}
            {tab?.dirty && <span className="sb-dirty">● unsaved</span>}
          </>
        ) : (
          <span>No workspace open</span>
        )}
      </span>
      <span className="sb-right">
        {rendererId && <span>{rendererLabel(rendererId as never)}</span>}
        {stats && <span>{stats}</span>}
      </span>
    </footer>
  );
}
