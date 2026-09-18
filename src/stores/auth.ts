import { create } from 'zustand';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api, type ApiUser, type DriveStatus, type AppConfig, type PasskeyInfo } from '../services/api';
import { toast } from './toast';

interface AuthState {
  ready: boolean;
  config: AppConfig | null;
  user: ApiUser | null;
  drive: DriveStatus;
  loading: boolean;
  passkeys: PasskeyInfo[];

  authModalOpen: boolean;
  authModalTab: 'login' | 'register';
  accountModalOpen: boolean;

  setAuthModal: (open: boolean, tab?: 'login' | 'register') => void;
  setAccountModal: (open: boolean) => void;

  bootstrap: () => Promise<void>;
  signInDemo: () => Promise<void>;
  signInGoogle: (withDrive: boolean) => void;
  signInEmail: (email: string, password: string) => Promise<boolean>;
  registerEmail: (email: string, password: string, displayName?: string) => Promise<boolean>;
  setPassword: (password: string, currentPassword?: string) => Promise<boolean>;
  signInPasskey: () => Promise<boolean>;
  registerPasskey: (name?: string) => Promise<boolean>;
  fetchPasskeys: () => Promise<void>;
  deletePasskey: (id: string) => Promise<void>;
  logout: () => Promise<void>;
  connectDrive: () => void;
  disconnectDrive: () => Promise<void>;
  refreshDrive: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  config: null,
  user: null,
  drive: { status: 'disconnected' },
  loading: false,
  passkeys: [],

  authModalOpen: false,
  authModalTab: 'login',
  accountModalOpen: false,

  setAuthModal: (open, tab = 'login') => set({ authModalOpen: open, authModalTab: tab }),
  setAccountModal: (open) => {
    set({ accountModalOpen: open });
    if (open && get().user) {
      void get().fetchPasskeys();
    }
  },

  bootstrap: async () => {
    try {
      const cfg = await api.config();
      const me = await api.me();
      set({ config: cfg, user: me.user, drive: me.drive, ready: true });
      if (me.user) {
        void get().fetchPasskeys();
      }
    } catch {
      set({ ready: true }); // backend unreachable — app still works locally
    }
  },

  signInDemo: async () => {
    set({ loading: true });
    try {
      await api.signInDemo();
      await get().bootstrap();
      toast('Signed in as Demo User (sandbox)', 'ok');
    } catch (e) {
      toast(String((e as Error).message), 'warn');
    }
    set({ loading: false });
  },

  signInGoogle: (withDrive) => api.googleStart(withDrive),

  signInEmail: async (email, password) => {
    set({ loading: true });
    try {
      const res = await api.login({ email, password });
      set({ user: res.user, authModalOpen: false });
      await get().bootstrap();
      toast(`Signed in as ${res.user.displayName || res.user.email}`, 'ok');
      set({ loading: false });
      return true;
    } catch (e) {
      toast(String((e as Error).message), 'warn');
      set({ loading: false });
      return false;
    }
  },

  registerEmail: async (email, password, displayName) => {
    set({ loading: true });
    try {
      const res = await api.register({ email, password, displayName });
      set({ user: res.user, authModalOpen: false });
      await get().bootstrap();
      toast(`Account created! Welcome, ${res.user.displayName || res.user.email}`, 'ok');
      set({ loading: false });
      return true;
    } catch (e) {
      toast(String((e as Error).message), 'warn');
      set({ loading: false });
      return false;
    }
  },

  setPassword: async (password, currentPassword) => {
    set({ loading: true });
    try {
      const res = await api.setPassword({ password, currentPassword });
      set({ user: res.user });
      toast('Password saved successfully! You can now sign in with this password.', 'ok');
      set({ loading: false });
      return true;
    } catch (e) {
      toast(String((e as Error).message), 'warn');
      set({ loading: false });
      return false;
    }
  },

  signInPasskey: async () => {
    if (!browserSupportsWebAuthn()) {
      toast('Passkeys are not supported in this browser.', 'warn');
      return false;
    }
    set({ loading: true });
    try {
      const options = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      const res = await api.passkeyLoginVerify(response);
      set({ user: res.user, authModalOpen: false });
      await get().bootstrap();
      toast(`Signed in with Passkey! Welcome, ${res.user.displayName || res.user.email}`, 'ok');
      set({ loading: false });
      return true;
    } catch (e: any) {
      if (e.name === 'NotAllowedError') {
        // User cancelled the prompt
        set({ loading: false });
        return false;
      }
      toast(String(e.message || e), 'warn');
      set({ loading: false });
      return false;
    }
  },

  registerPasskey: async (name) => {
    if (!browserSupportsWebAuthn()) {
      toast('Passkeys are not supported in this browser.', 'warn');
      return false;
    }
    set({ loading: true });
    try {
      const options = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      const res = await api.passkeyRegisterVerify(response, name);
      set({ user: res.user, passkeys: res.passkeys });
      toast('Passkey created! You can now log in instantly using your fingerprint, face, or security key.', 'ok');
      set({ loading: false });
      return true;
    } catch (e: any) {
      if (e.name === 'NotAllowedError') {
        set({ loading: false });
        return false;
      }
      toast(String(e.message || e), 'warn');
      set({ loading: false });
      return false;
    }
  },

  fetchPasskeys: async () => {
    try {
      const res = await api.listPasskeys();
      set({ passkeys: res.passkeys });
    } catch {
      // not authenticated or network error
    }
  },

  deletePasskey: async (id) => {
    try {
      const res = await api.deletePasskey(id);
      set({ user: res.user, passkeys: res.passkeys });
      toast('Passkey removed', 'ok');
    } catch (e) {
      toast(String((e as Error).message), 'warn');
    }
  },

  logout: async () => {
    try { await api.logout(); } catch { /* ignore */ }
    set({ user: null, drive: { status: 'disconnected' }, passkeys: [] });
    toast('Signed out', 'ok');
  },

  connectDrive: () => get().signInGoogle(true),

  disconnectDrive: async () => {
    try {
      await api.driveDisconnect();
      set({ drive: { status: 'disconnected' } });
      toast('Google Drive disconnected — tokens removed from the server', 'ok');
    } catch (e) {
      toast(String((e as Error).message), 'warn');
    }
  },

  refreshDrive: async () => {
    try {
      const { drive } = await api.driveStatus();
      set({ drive });
    } catch { /* keep old state */ }
  },
}));
