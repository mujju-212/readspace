import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../stores/auth';
import { useCloudUI } from '../stores/cloudui';
import { useWorkspace } from '../stores/workspace';
import { toast } from '../stores/toast';

/**
 * Identity + Drive-authorization chips (AUTH-02): two separate, visible states.
 * Signed-out → Sign in menu (real Google OAuth, or demo sign-in in sandbox).
 * Signed-in → account chip; Drive chip shows connected / reconnect / connect.
 */
export function AccountMenu() {
  const {
    user,
    drive,
    config,
    loading,
    signInDemo,
    signInGoogle,
    signInPasskey,
    setAuthModal,
    setAccountModal,
    logout,
    connectDrive,
    disconnectDrive,
  } = useAuth();
  const { open: openCloudDialog } = useCloudUI();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!config) return null;

  /* ---- signed out ---- */
  if (!user) {
    return (
      <div className="acct-anchor" ref={ref}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAuthModal(true, 'login')}
          title="Sign in or create account"
        >
          Sign in
        </button>
      </div>
    );
  }

  /* ---- signed in: drive chip + account chip ---- */
  const driveChip = (() => {
    if (drive.status === 'connected') {
      return (
        <span className="drive-chip connected" title={`Google Drive connected (${drive.email ?? ''})`}>
          <span className="dot" /> Drive
        </span>
      );
    }
    if (drive.status === 'reauthorization_required') {
      return (
        <button type="button" className="drive-chip warn" onClick={connectDrive} title="Authorization expired — click to reconnect">
          ⚠ Reconnect Drive
        </button>
      );
    }
    return (
      <button type="button" className="drive-chip" onClick={connectDrive} title="Authorize your own Google Drive (OAuth)">
        Connect Drive
      </button>
    );
  })();

  return (
    <>
      {driveChip}
      <div className="acct-anchor" ref={ref}>
        <button type="button" className="acct-chip" onClick={() => setOpen((o) => !o)} title={`${user.email} — account menu`}>
          <span className="avatar">{(user.displayName ?? user.email)[0]?.toUpperCase()}</span>
          <span className="acct-email">{user.displayName ?? user.email}</span>
        </button>
        {open && (
          <div className="acct-pop" role="dialog" aria-label="Account">
            <div className="acct-row"><b>{user.displayName}</b></div>
            <div className="acct-row muted small">{user.email}</div>
            <div className="acct-row muted small">
              Drive: {drive.status === 'connected' ? `connected (${drive.email})` : drive.status}
            </div>

            <button
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'flex-start', marginTop: 8, gap: 8 }}
              onClick={() => { setOpen(false); setAccountModal(true); }}
            >
              <span>🔒</span> Account & Security
            </button>

            {drive.status === 'connected' && (
              <button
                type="button"
                className="btn"
                style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
                onClick={() => { void disconnectDrive(); setOpen(false); }}
              >
                Disconnect Drive
              </button>
            )}
            <button
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
              onClick={() => { setOpen(false); openCloudDialog({ type: 'saved-links' }); }}
            >
              Saved links
            </button>
            <button
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
              onClick={() => {
                void logout();
                setOpen(false);
                toast('Signed out', 'ok');
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Dropdown of cloud actions (upload / scan / download) for the open workspace. */
export function CloudMenu() {
  const { user, drive } = useAuth();
  const provider = useWorkspace((s) => s.provider);
  const { menuOpen, setMenu, open } = useCloudUI();
  const ref = useRef<HTMLDivElement>(null);
  const isCloud = provider?.kind === 'clouddrive';
  const isLocal = provider && ['fsa', 'fallback', 'sample'].includes(provider.kind);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, setMenu]);

  if (!user || drive.status !== 'connected' || !provider) return null;
  if (!isCloud && !isLocal) return null;

  return (
    <div className="acct-anchor" ref={ref}>
      <button type="button" className={`btn${menuOpen ? ' btn-ghost on' : ''}`} onClick={() => setMenu(!menuOpen)} title="Cloud transfer actions">
        Cloud ▾
      </button>
      {menuOpen && (
        <div className="acct-pop cloud-menu" role="menu">
          {isCloud ? (
            <>
              <button type="button" role="menuitem" onClick={() => { open({ type: 'download-file' }); setMenu(false); }}>Download current file…</button>
              <button type="button" role="menuitem" onClick={() => { open({ type: 'download-folder' }); setMenu(false); }}>Download this folder…</button>
              <button type="button" role="menuitem" onClick={() => { open({ type: 'upload-pick' }); setMenu(false); }}>Upload files here…</button>
              <button type="button" role="menuitem" onClick={() => { open({ type: 'dest-scan' }); setMenu(false); }}>Scan local for new files…</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { open({ type: 'upload-pick' }); setMenu(false); }}>Upload files to Drive…</button>
              <button type="button" role="menuitem" onClick={() => { open({ type: 'dest-scan' }); setMenu(false); }}>Upload new files to Drive…</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
