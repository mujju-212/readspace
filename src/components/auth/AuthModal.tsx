import React, { useState } from 'react';
import { useAuth } from '../../stores/auth';
import { toast } from '../../stores/toast';

export function AuthModal() {
  const {
    authModalOpen,
    authModalTab,
    setAuthModal,
    signInEmail,
    registerEmail,
    signInPasskey,
    signInGoogle,
    signInDemo,
    config,
    loading,
  } = useAuth();

  const [tab, setTab] = useState<'login' | 'register'>(authModalTab || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sync tab with store state when modal opens
  React.useEffect(() => {
    if (authModalOpen) {
      setTab(authModalTab);
    }
  }, [authModalOpen, authModalTab]);

  if (!authModalOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast('Please enter both email and password', 'warn');
      return;
    }
    setSubmitting(true);
    await signInEmail(email.trim(), password);
    setSubmitting(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast('Please enter both email and password', 'warn');
      return;
    }
    if (password.length < 6) {
      toast('Password must be at least 6 characters long', 'warn');
      return;
    }
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'warn');
      return;
    }
    setSubmitting(true);
    await registerEmail(email.trim(), password, displayName.trim());
    setSubmitting(false);
  };

  const handlePasskeyLogin = async () => {
    setSubmitting(true);
    await signInPasskey();
    setSubmitting(false);
  };

  return (
    <div className="overlay" onClick={() => setAuthModal(false)}>
      <div
        className="auth-modal"
        role="dialog"
        aria-label={tab === 'login' ? 'Sign in to ReadSpace' : 'Create a ReadSpace account'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-header">
          <div className="auth-brand">
            <span className="auth-logo-badge">📖</span>
            <div>
              <h2 className="auth-title">ReadSpace</h2>
              <p className="auth-subtitle">
                {tab === 'login' ? 'Welcome back! Sign in to continue.' : 'Create your account to start reading.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="auth-close-btn"
            onClick={() => setAuthModal(false)}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Tab switchers */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => setTab('login')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => setTab('register')}
          >
            Create Account
          </button>
        </div>

        {tab === 'login' ? (
          <div className="auth-body">
            {/* 1-Click Passkey login feature */}
            <div className="auth-passkey-box">
              <div className="auth-passkey-info">
                <span className="auth-passkey-icon">🔑</span>
                <div>
                  <div className="auth-passkey-title">1-Click Passkey Login</div>
                  <div className="auth-passkey-desc">
                    Biometrics, Windows Hello, Touch ID, or security key. No password required.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary auth-passkey-btn"
                disabled={submitting || loading}
                onClick={handlePasskeyLogin}
              >
                Sign in with Passkey
              </button>
            </div>

            <div className="auth-divider">
              <span>or sign in with email</span>
            </div>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="form-group">
                <label htmlFor="login-email">Email Address</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="login-password">Password</label>
                  <button
                    type="button"
                    className="auth-link-sm"
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary auth-submit-btn"
                disabled={submitting || loading}
              >
                {submitting ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="auth-oauth-buttons">
              <button
                type="button"
                className="btn auth-google-btn"
                onClick={() => signInGoogle(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8 }}>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                Continue with Google
              </button>

              {config?.mode === 'sandbox' && (
                <button
                  type="button"
                  className="btn auth-demo-btn"
                  onClick={() => signInDemo()}
                >
                  Demo Sign-in (Local Sandbox)
                </button>
              )}
            </div>

            <div className="auth-footer">
              <span>Don’t have an account?</span>{' '}
              <button type="button" className="auth-link" onClick={() => setTab('register')}>
                Create an account
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-body">
            <form onSubmit={handleRegister} className="auth-form">
              <div className="form-group">
                <label htmlFor="reg-name">Full Name (optional)</label>
                <input
                  id="reg-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="reg-email">Email Address</label>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="reg-password">Password (min 6 characters)</label>
                  <button
                    type="button"
                    className="auth-link-sm"
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="reg-confirm-password">Confirm Password</label>
                <input
                  id="reg-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="form-input"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary auth-submit-btn"
                disabled={submitting || loading}
              >
                {submitting ? 'Creating account…' : 'Create Account'}
              </button>
            </form>

            <div className="auth-divider">
              <span>or sign up with</span>
            </div>

            <button
              type="button"
              className="btn auth-google-btn"
              onClick={() => signInGoogle(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8 }}>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Sign up with Google
            </button>

            <div className="auth-footer">
              <span>Already have an account?</span>{' '}
              <button type="button" className="auth-link" onClick={() => setTab('login')}>
                Sign in
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
