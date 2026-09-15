import React, { useRef } from 'react';
import { useTabs } from '../stores/tabs';
import { rendererForExt } from '../services/fs/types';
import { Close, FileIcon } from './Icons';

/**
 * Tab bar from the sketch: one persistent tab per opened file, active tab
 * highlighted, unsaved dot, close button, drag to reorder (FR-10…FR-16).
 */
export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const activate = useTabs((s) => s.activate);
  const close = useTabs((s) => s.close);
  const closeOthers = useTabs((s) => s.closeOthers);
  const reorder = useTabs((s) => s.reorder);

  const dragIndex = useRef<number | null>(null);

  if (tabs.length === 0) return null;

  return (
    <div className="tabbar" role="tablist" aria-label="Open files">
      {tabs.map((tab, i) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`tab${active ? ' active' : ''}`}
            title={`${tab.path}${tab.dirty ? '\n(unsaved changes)' : ''}`}
            onClick={() => activate(tab.id)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void close(tab.id); } }}
            onContextMenu={(e) => { e.preventDefault(); void closeOthers(tab.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') activate(tab.id); }}
            draggable
            onDragStart={() => { dragIndex.current = i; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== i) reorder(dragIndex.current, i);
              dragIndex.current = null;
            }}
          >
            <FileIcon rendererId={tab.forceText ? 'text' : rendererForExt(tab.ext)} size={13} />
            <span className="tab-title">{tab.title}</span>
            {tab.dirty && <span className="dirty-dot" title="Unsaved changes" />}
            <button
              type="button"
              className="tab-close"
              title={tab.dirty ? 'Close (has unsaved changes)' : 'Close (Ctrl+W)'}
              aria-label={`Close ${tab.title}`}
              onClick={(e) => { e.stopPropagation(); void close(tab.id); }}
            >
              <Close size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
