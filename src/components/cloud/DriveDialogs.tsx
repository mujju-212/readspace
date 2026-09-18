import React, { useEffect, useRef, useState } from 'react';
import { api, type Candidate, type DriveFile } from '../../services/api';
import { useCloudUI } from '../../stores/cloudui';
import { SaveLinkDialog, SavedLinksPanel } from './SavedLinks';
import { DriveDialog } from '../DriveDialog';
import { useWorkspace } from '../../stores/workspace';
import { useAuth } from '../../stores/auth';
import { uploadFilesToDrive, uploadCandidatesToDrive, pickLocalDestination, downloadFromDrive } from '../../features/cloud/transfers';
import { ChevronRight, ChevronDown, Folder, Cloud } from '../Icons';
import { toast } from '../../stores/toast';
import { useTabs } from '../../stores/tabs';
import type { CloudDriveProvider } from '../../services/fs/cloud';
import { runWorkspaceDriveSync } from '../../features/cloud/autoSync';

/* ================= Drive folder destination picker ================= */

export function DestinationPicker({ title, busy, onPick, onClose }: {
  title: string;
  busy?: boolean;
  onPick: (folder: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [children, setChildren] = useState<Record<string, DriveFile[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ root: true });
  const [rootName, setRootName] = useState('My Drive');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const meta = await api.driveMeta('root');
        setRootName(meta.name);
        const { files } = await api.driveList('root');
        setChildren((c) => ({ ...c, root: files }));
      } catch (e) {
        setError(String((e as Error).message));
      }
    })();
  }, []);

  const toggle = async (id: string, name = rootName) => {
    const isOpen = !!expanded[id];
    setExpanded((e) => ({ ...e, [id]: !isOpen }));
    if (!isOpen && !children[id] && id !== 'root') {
      try {
        const { files } = await api.driveList(id);
        setChildren((c) => ({ ...c, [id]: files }));
      } catch (e) {
        setError(String((e as Error).message));
      }
    }
    void name;
  };

  const row = (f: DriveFile, depth: number): React.ReactNode => {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    if (!isFolder) return null;
    const isOpen = !!expanded[f.id];
    return (
      <div key={f.id}>
        <button
          type="button"
          className="tree-row"
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => void toggle(f.id)}
          onDoubleClick={() => onPick({ id: f.id, name: f.name })}
          title="Click to expand · double-click to choose this folder"
        >
          <span className="chevron">{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
          <Folder size={14} className="folder-ic" />
          <span className="tree-name">{f.name}</span>
        </button>
        {isOpen && (children[f.id] ?? []).map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="drive-dialog dest-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="dest-tree" role="tree">
          <button type="button" className="tree-row" onClick={() => void toggle('root')}>
            <span className="chevron">{expanded.root ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
            <Folder size={14} className="folder-ic" />
            <span className="tree-name">{rootName}</span>
          </button>
          {expanded.root && (children.root ?? []).map((f) => row(f, 1))}
        </div>
        {error && <div className="drive-error">⚠ {error}</div>}
        <div className="drive-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onPick({ id: 'root', name: rootName })}>
            Choose “{rootName}”
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= Upload-new-files review queue (DRV-05) ================= */

const CLASS_LABEL: Record<string, string> = {
  likely_new: 'New',
  same_candidate: 'In Drive',
  name_collision: 'Modified / Conflict',
  unsupported: 'Unsupported',
  unreadable: 'Unreadable',
};

export function ReviewUploads({ candidates, remoteCount, dest, onClose, onChangeDest }: {
  candidates: Candidate[];
  remoteCount: number;
  dest: { id: string; name: string };
  onClose: () => void;
  onChangeDest?: () => void;
}) {
  const provider = useWorkspace((s) => s.provider)!;
  const [tabFilter, setTabFilter] = useState<'all' | 'new' | 'collision' | 'same'>('all');
  const [checked, setChecked] = useState<Record<number, boolean>>(
    () => Object.fromEntries(candidates.map((c, i) => [i, c.classification === 'likely_new'])),
  );
  const [running, setRunning] = useState(false);

  const newCandidates = candidates.filter((c) => c.classification === 'likely_new');
  const collisionCandidates = candidates.filter((c) => c.classification === 'name_collision');
  const sameCandidates = candidates.filter((c) => c.classification === 'same_candidate');

  const newCount = newCandidates.length;
  const collisionCount = collisionCandidates.length;
  const sameCount = sameCandidates.length;

  const visibleCandidatesWithIdx = candidates
    .map((c, originalIdx) => ({ c, originalIdx }))
    .filter(({ c }) => {
      if (tabFilter === 'new') return c.classification === 'likely_new';
      if (tabFilter === 'collision') return c.classification === 'name_collision';
      if (tabFilter === 'same') return c.classification === 'same_candidate';
      return true;
    });

  const selectedCount = candidates.filter((_, i) => checked[i]).length;
  const allVisibleSelected =
    visibleCandidatesWithIdx.length > 0 &&
    visibleCandidatesWithIdx.every(({ originalIdx }) => !!checked[originalIdx]);

  const toggleAllVisible = () => {
    const next = { ...checked };
    const targetState = !allVisibleSelected;
    for (const { originalIdx } of visibleCandidatesWithIdx) {
      next[originalIdx] = targetState;
    }
    setChecked(next);
  };

  const selectNewOnly = () => {
    const next: Record<number, boolean> = {};
    candidates.forEach((c, i) => {
      if (c.classification === 'likely_new') next[i] = true;
    });
    setChecked(next);
  };

  const selectAll = () => {
    const next: Record<number, boolean> = {};
    candidates.forEach((c, i) => {
      if (c.classification !== 'unreadable') next[i] = true;
    });
    setChecked(next);
  };

  const selectNone = () => {
    setChecked({});
  };

  const performUpload = async (itemsToUpload: Candidate[], labelDesc: string) => {
    if (itemsToUpload.length === 0) return;
    setRunning(true);
    const { ok, failed } = await uploadCandidatesToDrive(provider, itemsToUpload, dest);
    setRunning(false);
    onClose();
    void useWorkspace.getState().refreshRoot();
    if (failed === 0) toast(`Uploaded ${ok} file(s) (${labelDesc}) to “${dest.name}”`, 'ok');
    else toast(`${ok} uploaded · ${failed} failed — see transfer panel`, 'warn');
  };

  return (
    <div className="overlay" onClick={running ? undefined : onClose}>
      <div className="drive-dialog review-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Local & Google Drive Comparison</h2>
        <div className="muted small drive-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          <span>
            Target in Drive: <b>📁 “{dest.name}”</b> ({remoteCount} file{remoteCount === 1 ? '' : 's'} in Drive). Nothing is uploaded until you confirm.
          </span>
          {onChangeDest && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '2px 8px', height: 22, color: 'var(--accent)' }}
              onClick={onChangeDest}
              title="Change target folder in Google Drive"
            >
              Change folder…
            </button>
          )}
        </div>

        {/* Summary metric pills */}
        <div className="review-stats-row">
          <div className="review-stat-pill stat-new" onClick={() => setTabFilter('new')} title="Click to view new files">
            <span className="stat-count">{newCount}</span>
            <span className="stat-lbl">New (Local only)</span>
          </div>
          <div className="review-stat-pill stat-same" onClick={() => setTabFilter('same')} title="Click to view synced files">
            <span className="stat-count">{sameCount}</span>
            <span className="stat-lbl">In Drive (Synced)</span>
          </div>
          <div className="review-stat-pill stat-col" onClick={() => setTabFilter('collision')} title="Click to view conflicts">
            <span className="stat-count">{collisionCount}</span>
            <span className="stat-lbl">Different / Modified</span>
          </div>
          <div className="review-stat-pill" onClick={() => setTabFilter('all')} title="Click to view all files">
            <span className="stat-count">{candidates.length}</span>
            <span className="stat-lbl">Total Local Files</span>
          </div>
        </div>

        {/* Filter and selection tools bar */}
        <div className="review-toolbar">
          <div className="review-tabs" role="tablist">
            <button
              type="button"
              className={`review-tab-btn${tabFilter === 'all' ? ' active' : ''}`}
              onClick={() => setTabFilter('all')}
            >
              All ({candidates.length})
            </button>
            <button
              type="button"
              className={`review-tab-btn${tabFilter === 'new' ? ' active' : ''}`}
              onClick={() => setTabFilter('new')}
            >
              New Only ({newCount})
            </button>
            <button
              type="button"
              className={`review-tab-btn${tabFilter === 'collision' ? ' active' : ''}`}
              onClick={() => setTabFilter('collision')}
            >
              Modified ({collisionCount})
            </button>
            <button
              type="button"
              className={`review-tab-btn${tabFilter === 'same' ? ' active' : ''}`}
              onClick={() => setTabFilter('same')}
            >
              Already in Drive ({sameCount})
            </button>
          </div>

          <div className="review-quick-select">
            <button type="button" className="btn btn-sm" onClick={selectNewOnly} title="Check only newly added files">
              Select New Only
            </button>
            <button type="button" className="btn btn-sm" onClick={selectAll} title="Check all files">
              Select All
            </button>
            <button type="button" className="btn btn-sm" onClick={selectNone} title="Uncheck all files">
              Clear
            </button>
          </div>
        </div>

        <div className="review-table-wrap">
          <table className="review-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all visible files"
                    title="Toggle all visible files"
                  />
                </th>
                <th>File Name & Path</th>
                <th>Status</th>
                <th>Local Size</th>
                <th>Comparison Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidatesWithIdx.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '24px 12px' }}>
                    No files found in this category.
                  </td>
                </tr>
              ) : (
                visibleCandidatesWithIdx.map(({ c, originalIdx }) => (
                  <tr key={c.relativePath} className={checked[originalIdx] ? 'row-checked' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!checked[originalIdx]}
                        onChange={(e) => setChecked((m) => ({ ...m, [originalIdx]: e.target.checked }))}
                        aria-label={`Select ${c.relativePath}`}
                      />
                    </td>
                    <td className="review-path" title={c.relativePath}>
                      <span className="review-fn">{c.name}</span>
                      {c.relativePath !== c.name && <span className="review-dir muted"> ({c.relativePath})</span>}
                    </td>
                    <td>
                      <span className={`class-chip class-${c.classification}`}>
                        {CLASS_LABEL[c.classification] ?? c.classification}
                      </span>
                    </td>
                    <td className="muted small">{c.size ? `${(c.size / 1024).toFixed(1)} KB` : '—'}</td>
                    <td className="muted small review-reason">{c.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="drive-actions review-actions-bar">
          <span className="muted small spacer">
            <b>{selectedCount}</b> of {candidates.length} selected
          </span>
          <button type="button" className="btn" disabled={running} onClick={onClose}>
            Cancel
          </button>
          {newCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={running}
              onClick={() => void performUpload(newCandidates, 'New files only')}
              title="Upload only newly added files without touching existing ones"
            >
              Upload New Only ({newCount})
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={running || candidates.length === 0}
            onClick={() => void performUpload(candidates.filter((c) => c.classification !== 'unreadable'), 'All files')}
            title="Upload all files in this workspace to Google Drive"
          >
            Upload All ({candidates.length})
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || selectedCount === 0}
            onClick={() => void performUpload(candidates.filter((_, i) => checked[i]), 'Selected files')}
            title="Upload only the files checked above"
          >
            {running ? 'Uploading…' : `Upload Selected (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= Transfer progress panel (UX-01/02) ================= */

export function TransferPanel() {
  const jobs = useTransfers((s) => s.jobs);
  const panelOpen = useTransfers((s) => s.panelOpen);
  const setPanelOpen = useTransfers((s) => s.setPanelOpen);
  const open = panelOpen;
  const running = jobs.filter((j) => j.status === 'running');
  const visible = open ? jobs.slice(-4) : running.slice(0, 1);

  if (jobs.length === 0) return null;
  return (
    <div className="transfer-panel" aria-live="polite">
      <button type="button" className="tp-head" onClick={() => setPanelOpen(!open)}>
        <Cloud size={13} />
        <span>{running.length > 0 ? `Transferring… (${running.length})` : 'Transfers'}</span>
        <span className="spacer" />
        {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="tp-body">
          {visible.map((job) => (
            <div key={job.id} className="tp-job">
              <div className="tp-job-head">
                <span className="tp-title">{job.title}</span>
                <span className={`tp-status st-${job.status}`}>{job.status}</span>
                {job.status === 'running' && (
                  <button type="button" className="icon-btn" title="Cancel job" onClick={() => useTransfers.getState().cancelJob(job.id)}>✕</button>
                )}
              </div>
              {job.items.slice(0, 6).map((it, i) => (
                <div key={i} className="tp-item">
                  <span className={`tp-dot st-${it.status}`} />
                  <span className="tp-name" title={it.name}>{it.name}</span>
                  <span className={`muted small st-${it.status}`}>{it.error ? 'failed' : it.status}</span>
                </div>
              ))}
              {job.items.length > 6 && <div className="muted small tp-more">…and {job.items.length - 6} more</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useTransfers } from '../../stores/transfers';

/* ================= Orchestrator rendered by App ================= */

export function CloudDialogs() {
  const dialog = useCloudUI((s) => s.dialog);
  const close = useCloudUI((s) => s.close);
  const open = useCloudUI((s) => s.open);
  const provider = useWorkspace((s) => s.provider);
  const activeTabPath = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const user = useAuth((s) => s.user);
  const drive = useAuth((s) => s.drive);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const cloudSync = useWorkspace((s) => s.cloudSync);
  const isSyncScanning = useWorkspace((s) => s.isSyncScanning);

  const cloudProvider = provider?.kind === 'clouddrive' ? (provider as CloudDriveProvider) : null;
  const isLocalWorkspace = !!provider && ['fsa', 'fallback', 'sample'].includes(provider.kind);

  /* upload-pick: hidden input opens; files then go straight up (cloud root) or via destination picker */
  if (dialog.type === 'upload-pick') {
    const target: 'root' | 'dest' = cloudProvider ? 'root' : 'dest';
    return (
      <input
        ref={(el) => {
          if (el) setTimeout(() => el.click(), 30);
        }}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          close();
          if (files.length === 0) return;
          if (!user || drive.status !== 'connected') {
            toast(user ? 'Connect Google Drive first' : 'Sign in and connect Google Drive first', 'warn');
            return;
          }
          if (target === 'root' && cloudProvider) {
            void uploadFilesToDrive(files, { id: cloudProvider.rootId, name: cloudProvider.label }).then(() => useWorkspace.getState().refreshRoot());
          } else {
            open({ type: 'dest-upload', files });
          }
        }}
      />
    );
  }

  if (dialog.type === 'dest-upload') {
    if (dialog.files.length === 0) { close(); return null; }
    return (
      <DestinationPicker
        title="Upload to which Drive folder?"
        onPick={(dest) => {
          close();
          void uploadFilesToDrive(dialog.files, dest);
        }}
        onClose={close}
      />
    );
  }

  if (dialog.type === 'dest-scan') {
    if (!user || drive.status !== 'connected') {
      toast(user ? 'Connect Google Drive first' : 'Sign in and connect Google Drive first', 'warn');
      close();
      return null;
    }
    if (!isLocalWorkspace) {
      toast('Open a local folder first — the scan compares it with Drive', 'warn');
      close();
      return null;
    }

    if (showDestPicker) {
      return (
        <DestinationPicker
          title="Choose Drive folder to sync with"
          onPick={async (dest) => {
            setShowDestPicker(false);
            toast(`Syncing with “${dest.name}”…`, 'info');
            void runWorkspaceDriveSync(dest);
          }}
          onClose={() => setShowDestPicker(false)}
        />
      );
    }

    if (cloudSync) {
      return (
        <ReviewUploads
          candidates={cloudSync.candidates}
          remoteCount={cloudSync.remoteCount}
          dest={{ id: cloudSync.destId, name: cloudSync.destName }}
          onChangeDest={() => setShowDestPicker(true)}
          onClose={close}
        />
      );
    }

    // Trigger sync if not started
    if (!isSyncScanning) {
      void runWorkspaceDriveSync();
    }

    return (
      <div className="overlay" onClick={close}>
        <div className="drive-dialog" style={{ textAlign: 'center', padding: '36px 24px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>☁️</div>
          <h2>Comparing with Google Drive…</h2>
          <p className="muted small">
            Scanning local files and matching with Drive in background.
          </p>
          <div style={{ marginTop: 12 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.6s linear infinite', verticalAlign: 'middle', marginRight: 8 }} />
            <span className="small">Checking files…</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-sm" onClick={close}>
              Dismiss to background
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (dialog.type === 'save-link') {
    return (
      <SaveLinkDialog
        prefill={dialog.prefill}
        url={dialog.url}
        focusCollection={dialog.focusCollection}
        onClose={close}
      />
    );
  }

  if (dialog.type === 'saved-links') {
    return <SavedLinksPanel onClose={close} />;
  }

  if (dialog.type === 'drive-open') {
    return <DriveDialog onClose={close} />;
  }

  if (dialog.type === 'download-file') {
    close();
    void (async () => {
      if (!cloudProvider || !activeTabPath) {
        toast('Open a Drive file first, then download it', 'warn');
        return;
      }
      const fileId = cloudProvider.fileIdFor(activeTabPath);
      if (!fileId) {
        toast('This tab is not a connected-Drive file', 'warn');
        return;
      }
      const dest = await pickLocalDestination();
      if (dest === 'cancelled') return;
      try {
        const meta = await api.driveMeta(fileId);
        await downloadFromDrive({ files: [meta] }, dest === 'unavailable' ? null : dest);
        if (dest === 'unavailable') toast('Folder writing unavailable in this browser — used a browser download', 'info');
      } catch (e) {
        toast(String((e as Error).message), 'warn');
      }
    })();
    return null;
  }

  if (dialog.type === 'download-folder') {
    if (!cloudProvider) { close(); return null; }
    return (
      <DestinationPicker
        title="Download which Drive folder?"
        onPick={async (folder) => {
          close();
          const dest = await pickLocalDestination();
          if (dest === 'cancelled') return;
          const id = folder.id === 'root' ? cloudProvider.rootId : folder.id;
          try {
            await downloadFromDrive({ files: [], rootFolder: { id, name: folder.name } }, dest === 'unavailable' ? null : dest);
            if (dest === 'unavailable') toast('This browser can’t write folders — files save as individual downloads', 'warn');
          } catch (e) {
            toast(String((e as Error).message), 'warn');
          }
        }}
        onClose={close}
      />
    );
  }

  return null;
}
