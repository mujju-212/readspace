import React, { useState } from 'react';
import { useAuth } from '../../stores/auth';
import { toast } from '../../stores/toast';

export function AccountSecurityModal() {
  const {
    user,
    accountModalOpen,
    setAccountModal,
    setPassword,
    registerPasskey,
    deletePasskey,
    passkeys,
    loading,
    drive,
  } = useAuth();

  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submittingPassword, setSubmittingPassword] = useState(false);

  const [passkeyName, setPasskeyName] = useState('');
  const [showAddPasskey, setShowAddPasskey] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);

  if (!accountModalOpen || !user) return null;

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast('Password must be at least 6 characters long', 'warn');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', 'warn');
      return;
    }
    if (user.hasPassword && !currentPassword) {
      toast('Please enter your current password', 'warn');
      return;
    }

    setSubmittingPassword(true);
    const success = await setPassword(newPassword, currentPassword || undefined);
    setSubmittingPassword(false);
    if (success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSectionOpen(false);
    }
  };

  const handleCreatePasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisteringPasskey(true);
    const success = await registerPasskey(passkeyName.trim() || undefined);
    setRegisteringPasskey(false);
    if (success) {
      setPasskeyName('');
      setShowAddPasskey(false);
    }
  };

  return (
    <div className="overlay" onClick={() => setAccountModal(false)}>
      <div
        className="account-modal"
        role="dialog"
        aria-label="Account & Security Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="account-modal-header">
          <div className="account-profile-summary">
            <span className="account-avatar-lg">
              {(user.displayName || user.email)[0]?.toUpperCase()}
            </span>
            <div>
              <h2 className="account-name">{user.displayName || 'ReadSpace Reader'}</h2>
              <p className="account-email muted small">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            className="auth-close-btn"
            onClick={() => setAccountModal(false)}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="account-modal-body">
          {/* Linked services info */}
          <div className="security-card">
            <div className="security-card-header">
              <span className="security-icon">☁️</span>
              <div>
                <div className="security-card-title">Google Drive Connection</div>
                <div className="security-card-sub">
                  {drive.status === 'connected'
                    ? `Connected as ${drive.email || user.email}`
                    : 'Google Drive is not connected'}
                </div>
              </div>
            </div>
          </div>

          {/* Password Settings */}
          <div className="security-card">
            <div className="security-card-header">
              <span className="security-icon">🔒</span>
              <div style={{ flex: 1 }}>
                <div className="security-card-title">Account Password</div>
                <div className="security-card-sub">
                  {user.hasPassword ? (
                    <span className="status-badge status-ok">✓ Password configured</span>
                  ) : (
                    <span className="status-badge status-warn">
                      No password set (Google sign-in)
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPasswordSectionOpen((o) => !o)}
              >
                {user.hasPassword
                  ? passwordSectionOpen
                    ? 'Cancel'
                    : 'Change password'
                  : passwordSectionOpen
                  ? 'Cancel'
                  : 'Set password'}
              </button>
            </div>

            {passwordSectionOpen && (
              <form onSubmit={handleSavePassword} className="security-form">
                <p className="small muted" style={{ margin: '0 0 12px' }}>
                  {user.hasPassword
                    ? 'Enter your current password and choose a new one.'
                    : 'Set a password so you can log in directly using your email and password without needing Google.'}
                </p>

                {user.hasPassword && (
                  <div className="form-group">
                    <label htmlFor="sec-cur-pwd">Current Password</label>
                    <input
                      id="sec-cur-pwd"
                      type="password"
                      required
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="form-input"
                    />
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="sec-new-pwd">New Password (min 6 chars)</label>
                  <input
                    id="sec-new-pwd"
                    type="password"
                    required
                    minLength={6}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sec-confirm-pwd">Confirm New Password</label>
                  <input
                    id="sec-confirm-pwd"
                    type="password"
                    required
                    minLength={6}
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingPassword || loading}
                  >
                    {submittingPassword ? 'Saving…' : 'Save Password'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setPasswordSectionOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Passkeys Section */}
          <div className="security-card">
            <div className="security-card-header">
              <span className="security-icon">🔑</span>
              <div style={{ flex: 1 }}>
                <div className="security-card-title">Passkeys (WebAuthn)</div>
                <div className="security-card-sub">
                  Sign in instantly with biometrics (Face ID, Touch ID, Windows Hello) or security key. No password required.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setShowAddPasskey((s) => !s)}
              >
                {showAddPasskey ? 'Cancel' : '+ Add Passkey'}
              </button>
            </div>

            {showAddPasskey && (
              <form onSubmit={handleCreatePasskey} className="security-form">
                <div className="form-group">
                  <label htmlFor="passkey-name">Passkey Name (e.g., My Laptop, Windows Hello)</label>
                  <input
                    id="passkey-name"
                    type="text"
                    placeholder="e.g. My Laptop Windows Hello"
                    value={passkeyName}
                    onChange={(e) => setPasskeyName(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={registeringPasskey || loading}
                  >
                    {registeringPasskey ? 'Activating sensor…' : 'Prompt Sensor & Register'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setShowAddPasskey(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* List of registered passkeys */}
            <div className="passkeys-list">
              {passkeys.length === 0 ? (
                <div className="passkeys-empty muted small">
                  No passkeys registered yet. Click <b>+ Add Passkey</b> to enable 1-click biometric login on this device.
                </div>
              ) : (
                passkeys.map((pk) => (
                  <div key={pk.id} className="passkey-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>🛡️</span>
                      <div>
                        <div className="passkey-title">{pk.name || 'Passkey'}</div>
                        <div className="passkey-date muted small">
                          Added on {new Date(pk.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost passkey-del-btn"
                      onClick={() => deletePasskey(pk.id)}
                      title="Delete this passkey"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="account-modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAccountModal(false)}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
