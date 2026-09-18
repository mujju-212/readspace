import { create } from 'zustand';
import type { ParsedDriveLink } from '../services/fs/gdrive';

/** Dialog/menu state for cloud features (kept out of App to avoid prop drills). */
export type CloudDialog =
  | { type: 'none' }
  | { type: 'upload-pick' }
  | { type: 'dest-upload'; files: File[] }
  | { type: 'dest-scan' }
  | { type: 'download-file' }
  | { type: 'download-folder' }
  | { type: 'save-link'; prefill: ParsedDriveLink; url: string; focusCollection?: boolean }
  | { type: 'saved-links' }
  | { type: 'drive-open' };

interface CloudUIState {
  dialog: CloudDialog;
  menuOpen: boolean;
  open: (d: CloudDialog) => void;
  close: () => void;
  setMenu: (open: boolean) => void;
}

export const useCloudUI = create<CloudUIState>((set) => ({
  dialog: { type: 'none' },
  menuOpen: false,
  open: (dialog) => set({ dialog, menuOpen: false }),
  close: () => set({ dialog: { type: 'none' } }),
  setMenu: (menuOpen) => set({ menuOpen }),
}));
