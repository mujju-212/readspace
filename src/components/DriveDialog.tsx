import React, { useMemo, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useAuth } from '../stores/auth';
import { useCloudUI } from '../stores/cloudui';
import { parseGDriveLink, storedDriveKey, storeDriveKey, openGDriveLink, openGDriveKeyless } from '../services/fs/gdrive';
import { toast } from '../stores/toast';

const KIND_LABEL: Record<string, string> = {
  file: 'File', folder: 'Folder', gdoc: 'Google Doc', gsheet: 'Google Sheet', gppt: 'Google Slides',
};

const KEY_STEPS = (
  <ol>
    <li>
      <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Create a Google Cloud project</a>{' '}
      (any name, no credit card)
    </li>
    <li>
      <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Enable the Google Drive API</a>{' '}
      for that project
    </li>
    <li>
      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Create an API key</a>{' '}
      and paste it below
    </li>
  </ol>
);

/**
 * "Open from Google Drive" — paste a link to a public file or folder.
 * - Docs/Sheets/Slides: opens without any key (Google's export endpoints are public).
 * - Folders & uploaded files: Google requires a signed Drive API call, so a free
 *   API key is needed (stored only in this browser).
 */
export function DriveDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const [key, setKey] = useState(storedDriveKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyUi, setKeyUi] = useState(false);
  const { user, drive } = useAuth();
  const { open: openDialog } = useCloudUI();
  const detected = useMemo(() => parseGDriveLink(link), [link]);
  const isFolder = detected?.hint === 'folder';
  const isNativeDoc = !!detected && !isFolder; // Doc / Sheet / Slides / plain file id
  const driveConnected = !!user && drive.status === 'connected';
  const showKeyUi = !driveConnected && (isFolder || keyUi || !detected);
  const canOpen = !!detected && (!isFolder || key.trim().length > 0 || driveConnected);

  const open = async () => {
    setError(null);
    if (!detected) { setError('Paste a Google Drive file or folder link (or a bare file ID).'); return; }
    setBusy(true);
    try {
      if (driveConnected) {
        const { CloudDriveProvider } = await import('../services/fs/cloud');
        await useWorkspace.getState().installProvider(new CloudDriveProvider(detected.id));
        toast(isFolder ? 'Opened Drive folder as workspace' : 'Opened Drive workspace', 'ok');
        onClose();
        return;
      }
      let installed = false;
      // Google-native docs open without any key — try that first
      if (!isFolder) {
        try {
          const p = await openGDriveKeyless(link);
          if (p) {
            await useWorkspace.getState().installProvider(p);
            installed = true;
          }
        } catch (e) {
          if (!key.trim()) { setKeyUi(true); throw e; }
          // else fall through to the API-key path
        }
      }
      if (!installed) {
        if (!key.trim()) {
          setError('This link needs a Google API key — the free steps are right here. Paste the key and press Open.');
          setKeyUi(true);
          setBusy(false);
          return;
        }
        storeDriveKey(key.trim());
        const p = await openGDriveLink(link, key.trim());
        if (!p) { setBusy(false); setError('Could not read that link — double-check it and try again.'); return; }
        await useWorkspace.getState().installProvider(p);
      }
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setKeyUi(true);
      setBusy(false);
      return;
    }
    toast(`Opened from Google Drive`, 'ok');
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drive-dialog" role="dialog" aria-modal="true" aria-label="Open from Google Drive" onClick={(e) => e.stopPropagation()}>
        <h2>Open from Google Drive</h2>
        <p className="muted small drive-sub">
          Paste a link to a <b>file</b> or a whole <b>folder</b>. The item must be shared as
          “Anyone with the link can view”. Folders open in the sidebar just like local folders.
        </p>

        <input
          className="drive-link"
          placeholder="https://drive.google.com/drive/folders/… or docs.google.com/… or a bare ID"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canOpen) void open(); }}
          aria-label="Google Drive link"
          autoFocus
        />
        <div className="drive-detect muted small" aria-live="polite">
          {link
            ? detected
              ? `${KIND_LABEL[detected.hint]} detected · ID ${detected.id.slice(0, 12)}…`
              : 'Not a recognizable Drive link (yet)'
            : 'Docs, Sheets and Slides open as text / CSV exports.'}
        </div>

        {isNativeDoc && !keyUi && (
          <div className="drive-note drive-note-ok">
            ✓ Google Docs / Sheets / Slides open <b>without any key</b>.
          </div>
        )}

        {isNativeDoc && keyUi && (
          <div className="drive-note">
            Google only lets browsers download <b>uploaded files</b> (PDF, DOCX…) through the signed API —
            that's why the key is needed even for one file. Docs/Sheets/Slides never need it.
          </div>
        )}

        {isFolder && (
          <div className="drive-note">
            <b>Why a key?</b> Listing a folder's contents is a <b>Drive API call</b>, and Google only allows
            signed API calls — “anyone with the link” applies to Google's own website, not to apps reading the
            folder. The key is <b>free, needs no credit card</b>, and is stored only in this browser:
            {KEY_STEPS}
          </div>
        )}

        {showKeyUi && (
          <input
            className="drive-key"
            placeholder="Google API key (free — see steps above)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canOpen) void open(); }}
            aria-label="Google API key"
          />
        )}

        {!detected && (
          <details className="drive-how">
            <summary>How do I get a free API key? (2 minutes)</summary>
            {KEY_STEPS}
          </details>
        )}

        {error && <div className="drive-error" role="alert">⚠ {error}</div>}

        <div className="drive-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {user && detected && (
            <>
              <button
                type="button"
                className="btn"
                title="Bookmark this link to your account"
                onClick={() => { onClose(); openDialog({ type: 'save-link', prefill: detected, url: link }); }}
              >Save link</button>
              <button
                type="button"
                className="btn"
                title="Save into a collection like College, Projects, Books"
                onClick={() => { onClose(); openDialog({ type: 'save-link', prefill: detected, url: link, focusCollection: true }); }}
              >Save to collection…</button>
            </>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !canOpen} onClick={() => void open()}>
            {busy ? 'Opening…' : isFolder ? 'Open folder' : 'Open file'}
          </button>
        </div>
        {!user && detected && (
          <div className="muted small drive-sub">Tip: sign in to save this link to your account for later.</div>
        )}
      </div>
    </div>
  );
}
