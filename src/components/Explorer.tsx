import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useTabs } from '../stores/tabs';
import { useSettings } from '../stores/settings';
import { useCloudUI } from '../stores/cloudui';
import { useAuth } from '../stores/auth';
import type { FsEntry } from '../services/fs/types';
import { rendererForExt } from '../services/fs/types';
import { ChevronDown, ChevronRight, FileIcon, Folder, FolderOpen, Refresh, Search, Cloud, CloudUpload } from './Icons';
import { toast } from '../stores/toast';
import { runWorkspaceDriveSync } from '../features/cloud/autoSync';

/**
 * The Explorer sidebar from the sketch:
 *   "File open" header · Library tree · folders > files (FR-1…FR-6)
 */

export function Explorer() {
  const provider = useWorkspace((s) => s.provider);
  const entries = useWorkspace((s) => s.entries);
  const expanded = useWorkspace((s) => s.expanded);
  const selected = useWorkspace((s) => s.selected);
  const filter = useWorkspace((s) => s.filter);
  const setFilter = useWorkspace((s) => s.setFilter);
  const toggleDir = useWorkspace((s) => s.toggleDir);
  const refreshRoot = useWorkspace((s) => s.refreshRoot);
  const walkAll = useWorkspace((s) => s.walkAll);
  const busy = useWorkspace((s) => s.busy);
  const error = useWorkspace((s) => s.error);
  const cloudSync = useWorkspace((s) => s.cloudSync);
  const isSyncScanning = useWorkspace((s) => s.isSyncScanning);
  const showHidden = useSettings((s) => s.showHidden);

  const user = useAuth((s) => s.user);
  const drive = useAuth((s) => s.drive);
  const openCloud = useCloudUI((s) => s.open);
  const isLocal = !!provider && ['fsa', 'fallback', 'sample'].includes(provider.kind);

  const openPath = useTabs((s) => s.openPath);
  const containerRef = useRef<HTMLDivElement>(null);

  const [allFiles, setAllFiles] = useState<Array<{ path: string; ext?: string }> | null>(null);
  const [walking, setWalking] = useState(false);

  // Automatically start background sync comparison when a local workspace is active and Drive is connected
  useEffect(() => {
    if (isLocal && drive.status === 'connected' && provider && !cloudSync && !isSyncScanning) {
      void runWorkspaceDriveSync();
    }
  }, [isLocal, drive.status, provider, cloudSync, isSyncScanning]);

  // when a filter is typed, lazily build the full file list (TRD §3.4 + FR-5)
  useEffect(() => {
    if (!filter) { setAllFiles(null); return; }
    if (allFiles !== null || walking) return;
    setWalking(true);
    void walkAll().then((files) => { setAllFiles(files); setWalking(false); });
  }, [filter, allFiles, walking, walkAll]);

  const filtered = useMemo(() => {
    if (!filter || !allFiles) return null;
    const q = filter.toLowerCase();
    return allFiles.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 300);
  }, [filter, allFiles]);

  const activate = (entry: FsEntry) => {
    if (entry.kind === 'directory') void toggleDir(entry.path);
    else {
      useWorkspace.getState().select(entry.path);
      openPath(entry.path, { ext: entry.ext });
    }
  };

  const onContainerKeyDown = (e: React.KeyboardEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tree-row'));
    const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' && idx >= 0 && idx < rows.length - 1) {
      e.preventDefault(); rows[idx + 1].focus();
    } else if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault(); rows[idx - 1].focus();
    } else if (e.key === 'ArrowRight' && idx >= 0) {
      const path = rows[idx].dataset.path!;
      if (!useWorkspace.getState().expanded[path]) { e.preventDefault(); void useWorkspace.getState().toggleDir(path); }
    } else if (e.key === 'ArrowLeft' && idx >= 0) {
      const path = rows[idx].dataset.path!;
      if (useWorkspace.getState().expanded[path]) { e.preventDefault(); void useWorkspace.getState().toggleDir(path); }
    } else if (e.key === 'Enter' && idx >= 0) {
      e.preventDefault(); rows[idx].click();
    }
  };

  const renderNode = (entry: FsEntry, depth: number): React.ReactNode => (
    <TreeNodeItem
      key={entry.path}
      entry={entry}
      depth={depth}
      showHidden={showHidden}
      cloudSync={cloudSync}
      provider={provider}
      selected={selected}
      activate={activate}
      openPath={openPath}
      renderNode={renderNode}
    />
  );

  return (
    <div className="explorer">
      <div className="explorer-head">
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span className="explorer-title">{provider?.label ?? 'EXPLORER'}</span>
          {provider?.kind === 'clouddrive' && (provider as any).rootId !== 'root' && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '1px 6px', height: 20, alignSelf: 'flex-start', marginTop: 2, color: 'var(--accent)' }}
              title="Return to full Google Drive"
              onClick={async () => {
                const { CloudDriveProvider } = await import('../services/fs/cloud');
                await useWorkspace.getState().installProvider(new CloudDriveProvider('root', 'Google Drive'));
                toast('Switched to My Drive root', 'ok');
              }}
            >
              ← My Drive (all folders)
            </button>
          )}
        </div>
        <span className="explorer-actions">
          {isLocal && (
            <button
              type="button"
              className="icon-btn sync-btn"
              title={drive.status === 'connected' ? 'Compare & sync with Google Drive' : 'Sign in / Connect Google Drive to sync'}
              onClick={() => {
                if (drive.status === 'connected') {
                  if (cloudSync) {
                    openCloud({ type: 'dest-scan' });
                  } else {
                    void runWorkspaceDriveSync();
                    toast('Syncing with Google Drive in background…', 'info');
                  }
                } else {
                  toast('Connect Google Drive to compare and sync files', 'info');
                  openCloud({ type: 'drive-open' });
                }
              }}
            >
              <CloudUpload size={13} />
            </button>
          )}
          <button type="button" className="icon-btn" title="Refresh tree (FR-6)" onClick={() => { void refreshRoot(); toast('Refreshed', 'ok'); }}>
            <Refresh size={13} />
          </button>
        </span>
      </div>

      {isLocal && drive.status === 'connected' && (
        <div className="explorer-sync-bar">
          <div className="sync-bar-left">
            <Cloud size={12} className={cloudSync || isSyncScanning ? 'sync-active' : ''} />
            {isSyncScanning ? (
              <span className="sync-bar-text">
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.6s linear infinite', marginRight: 5, verticalAlign: 'middle' }} />
                Comparing in background…
              </span>
            ) : cloudSync ? (
              <span className="sync-bar-text" title={`Compared with Drive folder "${cloudSync.destName}"`}>
                Drive: <b>{cloudSync.destName}</b>
                <span className="sync-pill-tag new" title={`${cloudSync.newCount} new local files`}>+{cloudSync.newCount}</span>
                <span className="sync-pill-tag same" title={`${cloudSync.sameCount} synced files`}>✓{cloudSync.sameCount}</span>
              </span>
            ) : (
              <span className="sync-bar-text">Google Drive ready</span>
            )}
          </div>
          <button
            type="button"
            className="sync-action-btn"
            onClick={() => {
              if (isSyncScanning) return;
              openCloud({ type: 'dest-scan' });
            }}
            title={cloudSync ? 'Review suggestions and upload files' : 'Compare with Google Drive'}
          >
            {isSyncScanning ? 'Syncing…' : cloudSync ? 'Review' : 'Sync'}
          </button>
        </div>
      )}

      <div className="filter-wrap">
        <Search size={12} />
        <input
          className="filter-box"
          placeholder="Filter files by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter files by name"
        />
        {filter && (
          <button type="button" className="icon-btn" onClick={() => setFilter('')} title="Clear filter">✕</button>
        )}
      </div>

      {error && (
        <div className="explorer-grant-wrap">
          <div className="explorer-error">⚠ Permission required to browse files.</div>
          {provider && 'handle' in provider && (
            <div style={{ padding: '4px 12px 10px' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ width: '100%', fontSize: 11, padding: '5px 10px' }}
                onClick={async () => {
                  const { reconnectFsa } = await import('../services/fs/open');
                  const ok = await reconnectFsa((provider as any).handle);
                  if (ok) {
                    void refreshRoot();
                    toast('Access granted', 'ok');
                  } else {
                    toast('Please allow permission in the browser prompt', 'warn');
                  }
                }}
              >
                Grant Access to “{provider.label}”
              </button>
            </div>
          )}
        </div>
      )}

      <div className="tree" ref={containerRef} role="tree" aria-label="Workspace files" onKeyDown={onContainerKeyDown}>
        {busy && <div className="tree-loading">Loading workspace…</div>}
        {!busy && filtered !== null ? (
          filtered.length === 0 ? (
            <div className="tree-loading">{walking ? 'Scanning…' : 'No files match.'}</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.path}
                type="button"
                className={`tree-row${selected === p.path ? ' selected' : ''}`}
                data-path={p.path}
                title={p.path}
                onClick={() => { useWorkspace.getState().select(p.path); openPath(p.path, { ext: p.ext }); }}
                onDoubleClick={() => openPath(p.path, { ext: p.ext })}
              >
                <span className="chevron" />
                <FileIcon rendererId={rendererForExt(p.ext ?? '')} />
                <span className="tree-name">{p.path.split('/').pop()}</span>
                {cloudSync && cloudSync.statusByPath[p.path] && (
                  <span className={`cloud-tree-chip chip-${cloudSync.statusByPath[p.path]}`}>
                    {cloudSync.statusByPath[p.path] === 'likely_new'
                      ? 'New'
                      : cloudSync.statusByPath[p.path] === 'same_candidate'
                      ? '✓ Drive'
                      : '~ Mod'}
                  </span>
                )}
                <span className="tree-dir">{p.path.split('/').slice(0, -1).join('/')}</span>
              </button>
            ))
          )
        ) : (
          !busy && (entries[''] ?? []).map((e) => renderNode(e, 0))
        )}
      </div>
    </div>
  );
}

function TreeNodeItem({
  entry,
  depth,
  showHidden,
  cloudSync,
  provider,
  selected,
  activate,
  openPath,
  renderNode,
}: {
  entry: FsEntry;
  depth: number;
  showHidden: boolean;
  cloudSync: any;
  provider: any;
  selected: string | null;
  activate: (entry: FsEntry) => void;
  openPath: (path: string, meta?: any) => void;
  renderNode: (entry: FsEntry, depth: number) => React.ReactNode;
}) {
  const isOpen = useWorkspace((s) => !!s.expanded[entry.path]);
  const children = useWorkspace((s) => s.entries[entry.path]);
  const isLoading = useWorkspace((s) => !!s.loadingPaths[entry.path]);
  const loadChildren = useWorkspace((s) => s.loadChildren);

  useEffect(() => {
    if (entry.kind === 'directory' && isOpen && children === undefined && !isLoading) {
      void loadChildren(entry.path);
    }
  }, [entry.kind, entry.path, isOpen, children, isLoading, loadChildren]);

  if (!isVisibleLocal(entry, showHidden)) return null;
  const isSelected = selected === entry.path;

  return (
    <div role="treeitem" aria-expanded={entry.kind === 'directory' ? isOpen : undefined} aria-selected={isSelected}>
      <button
        type="button"
        className={`tree-row${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        data-path={entry.path}
        title={entry.path}
        onClick={() => activate(entry)}
        onDoubleClick={() => { if (entry.kind === 'file') openPath(entry.path, { ext: entry.ext }); }}
      >
        {entry.kind === 'directory' ? (
          <span className="chevron">{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
        ) : (
          <span className="chevron" />
        )}
        {entry.kind === 'directory'
          ? (isOpen ? <FolderOpen size={14} className="folder-ic" /> : <Folder size={14} className="folder-ic" />)
          : <FileIcon rendererId={rendererForExt(entry.ext ?? '')} />}
        <span className="tree-name">{entry.name}</span>
        {entry.kind === 'file' && cloudSync && cloudSync.statusByPath[entry.path] && (
          <span
            className={`cloud-tree-chip chip-${cloudSync.statusByPath[entry.path]}`}
            title={
              cloudSync.statusByPath[entry.path] === 'likely_new'
                ? 'Local only — new file'
                : cloudSync.statusByPath[entry.path] === 'same_candidate'
                ? 'Synced in Drive'
                : cloudSync.statusByPath[entry.path] === 'name_collision'
                ? 'Different size in Drive'
                : 'Unsynced'
            }
          >
            {cloudSync.statusByPath[entry.path] === 'likely_new'
              ? 'New'
              : cloudSync.statusByPath[entry.path] === 'same_candidate'
              ? '✓ Drive'
              : '~ Mod'}
          </span>
        )}
        {entry.kind === 'directory' && provider?.kind === 'clouddrive' && (
          <span
            className="tree-row-action"
            title={`Focus only "${entry.name}" as workspace`}
            onClick={async (e) => {
              e.stopPropagation();
              const { CloudDriveProvider } = await import('../services/fs/cloud');
              const cloudP = provider as InstanceType<typeof CloudDriveProvider>;
              const folderId = cloudP.getFolderId(entry.path);
              if (folderId) {
                await useWorkspace.getState().installProvider(new CloudDriveProvider(folderId, entry.name));
                toast(`Opened "${entry.name}" as workspace`, 'ok');
              }
            }}
          >
            ⤢
          </span>
        )}
      </button>
      {entry.kind === 'directory' && isOpen && (
        <div role="group">
          {children === undefined || isLoading ? (
            <div className="tree-loading" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.6s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />
              Loading…
            </div>
          ) : children.length === 0 ? (
            <div className="tree-loading" style={{ paddingLeft: 6 + (depth + 1) * 14, fontStyle: 'italic', opacity: 0.6 }}>
              (empty)
            </div>
          ) : (
            children.map((c) => renderNode(c, depth + 1))
          )}
        </div>
      )}
    </div>
  );
}

function isVisibleLocal(entry: FsEntry, showHidden: boolean): boolean {
  if (!showHidden && entry.name.startsWith('.')) return false;
  return true;
}
