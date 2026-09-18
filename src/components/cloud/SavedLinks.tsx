import React, { useEffect, useMemo, useState } from 'react';
import { api, type SavedLink } from '../../services/api';
import type { ParsedDriveLink } from '../../services/fs/gdrive';
import { useCloudUI } from '../../stores/cloudui';
import { useAuth } from '../../stores/auth';
import { confirmDialog } from '../../stores/confirm';
import { toast } from '../../stores/toast';
import { refreshSavedLinks, setSavedLinksCache, openSavedLink } from '../../features/cloud/saved';

const KIND_LABEL: Record<string, string> = {
  file: 'File', folder: 'Folder', gdoc: 'Google Doc', gsheet: 'Google Sheet', gppt: 'Google Slides',
};

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/**
 * "Save to collection" dialog: stores a *reference* (title, URL, Drive id,
 * resourceKey, collection) in the user's account — never a copy of the file.
 */
export function SaveLinkDialog({ prefill, url, focusCollection, onClose }: {
  prefill: ParsedDriveLink;
  url: string;
  focusCollection?: boolean;
  onClose: () => void;
}) {
  const isFolder = prefill.hint === 'folder';
  const [title, setTitle] = useState('');
  const [collection, setCollection] = useState('');
  const [existing, setExisting] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ name: string; mimeType?: string; sharedBy?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { drive } = useAuth.getState();
      let fallback = isFolder ? 'Shared Drive folder' : `${KIND_LABEL[prefill.hint] ?? 'Shared Drive file'}`;
      if (drive.status === 'connected') {
        try {
          const m = await api.driveMeta(prefill.id, prefill.resourceKey);
          if (!alive) return;
          setMeta({ name: m.name, mimeType: m.mimeType });
          fallback = m.name;
        } catch { /* can't read it right now — a reference can still be saved */ }
      }
      if (alive) setTitle((t) => t || fallback);
      try {
        const { links } = await api.savedLinks();
        if (!alive) return;
        setExisting([...new Set(links.map((l) => l.collection).filter(Boolean) as string[])]);
      } catch { /* first save */ }
    })();
    return () => { alive = false; };
  }, [prefill.id, prefill.resourceKey, isFolder]);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { link, updated } = await api.savedLinkCreate({
        title: title.trim(),
        url: url.trim(),
        folderId: isFolder ? prefill.id : undefined,
        fileId: isFolder ? undefined : prefill.id,
        mimeType: meta?.mimeType,
        resourceKey: prefill.resourceKey,
        sharedBy: meta?.sharedBy,
        collection: collection.trim() || undefined,
      });
      await refreshSavedLinks();
      toast(updated ? `Updated “${link.title}” in your saved links` : collection.trim() ? `Saved to “${collection.trim()}”` : 'Saved to your links', 'ok');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the link', 'warn');
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drive-dialog save-link-dialog" role="dialog" aria-modal="true" aria-label="Save link" onClick={(e) => e.stopPropagation()}>
        <h2>{isFolder ? 'Save folder link' : 'Save link'}</h2>
        <p className="muted small drive-sub">
          ReadSpace saves a <b>reference</b> in your account — not a copy. Opening it later still
          follows the owner's sharing settings.
        </p>
        <div className="sl-meta muted small">
          {KIND_LABEL[prefill.hint] ?? 'Drive resource'} · ID <code>{prefill.id.slice(0, 14)}…</code>
          {prefill.resourceKey ? ' · resource key preserved' : ''}
        </div>
        <input
          className="sl-title"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !focusCollection) void save(); }}
          aria-label="Link title"
          autoFocus={!focusCollection}
        />
        <input
          className="sl-collection"
          placeholder="Collection (optional) — e.g. College, Projects, Books"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          list="sl-collections"
          aria-label="Collection"
          autoFocus={focusCollection}
        />
        <datalist id="sl-collections">
          {existing.map((c) => <option key={c} value={c} />)}
        </datalist>
        <div className="drive-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving || !title.trim()} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save link'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One saved link row: type badge, title, meta, Open + Remove. */
function SavedRow({ link, onOpened }: { link: SavedLink; onOpened: () => void }) {
  const [busy, setBusy] = useState(false);
  const isFolder = link.resourceType === 'folder';
  const { drive } = useAuth();
  const open = async () => {
    setBusy(true);
    try {
      // close the panel only when the link actually opened (kept on failure)
      if (await openSavedLink(link)) onOpened();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="saved-row">
      <span className={`saved-badge${isFolder ? ' dir' : ''}`} aria-hidden>{isFolder ? '▤' : '▭'}</span>
      <div className="saved-info">
        <div className="saved-title" title={link.url}>{link.title}</div>
        <div className="muted small saved-sub">
          Google Drive {isFolder ? 'folder' : 'file'}{link.sharedBy ? ` · Shared by ${link.sharedBy}` : ' · Shared link'}
          {' · '}Saved {timeAgo(link.addedAt)}
          {link.collection ? ` · ${link.collection}` : ''}
        </div>
        <div className="muted small saved-note">
          {drive.status === 'connected'
            ? (link.lastOpenedAt ? `Last opened ${timeAgo(link.lastOpenedAt)}${link.progress?.scrollTop ? ' · progress saved' : ''}` : 'Saved link · ready to open')
            : 'Saved link · Access may require Google sign-in'}
        </div>
      </div>
      <div className="saved-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void open()}>{busy ? 'Opening…' : 'Open'}</button>
        <button
          type="button"
          className="btn"
          title="Remove saved link"
          onClick={async () => {
            const ok = await confirmDialog(`Remove “${link.title}” from your saved links? The file itself is not touched.`);
            if (!ok) return;
            try {
              await api.savedLinkDelete(link._id);
              const links = await refreshSavedLinks();
              setSavedLinksCache(links);
              toast('Saved link removed', 'ok');
            } catch { toast('Could not remove the link', 'warn'); }
          }}
        >✕</button>
      </div>
    </div>
  );
}

/** The Saved Links panel: personal collection, grouped by user-defined collection. */
export function SavedLinksPanel({ onClose }: { onClose: () => void }) {
  const [links, setLinks] = useState<SavedLink[] | null>(null);
  const { open } = useCloudUI();
  const { user } = useAuth();

  useEffect(() => {
    let alive = true;
    api.savedLinks()
      .then(({ links: ls }) => { if (alive) { setLinks(ls); setSavedLinksCache(ls); } })
      .catch(() => { if (alive) setLinks([]); });
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, SavedLink[]>();
    for (const l of links ?? []) {
      const k = l.collection?.trim() || 'Saved links';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return [...map.entries()].sort((a, b) => (a[0] === 'Saved links' ? 1 : b[0] === 'Saved links' ? -1 : a[0].localeCompare(b[0])));
  }, [links]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drive-dialog saved-panel" role="dialog" aria-modal="true" aria-label="Saved links" onClick={(e) => e.stopPropagation()}>
        <h2>Saved Links</h2>
        <p className="muted small drive-sub">
          A personal collection of shared files and folders{user ? '' : ' — sign in to keep them in your account'}.
          References only: if an owner revokes access, the link stays but opens no more.
        </p>
        <div className="saved-list">
          {links === null && <div className="muted small">Loading…</div>}
          {links !== null && links.length === 0 && (
            <div className="muted small saved-empty">
              Nothing saved yet. Paste a Drive link (Drive button) and choose <b>Save link</b>.
            </div>
          )}
          {groups.map(([name, ls]) => (
            <div key={name} className="saved-group">
              <div className="saved-group-header muted small">{name} <span className="saved-count">{ls.length}</span></div>
              {ls.map((l) => (
                <SavedRow key={l._id} link={l} onOpened={onClose} />
              ))}
            </div>
          ))}
        </div>
        <div className="drive-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { onClose(); open({ type: 'drive-open' }); }}
          >Paste a new link…</button>
        </div>
      </div>
    </div>
  );
}
