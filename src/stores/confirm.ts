import { create } from 'zustand';

/**
 * In-app replacement for window.confirm (native dialogs are blocked inside
 * sandboxed preview iframes). Returns a promise resolved by the user's choice.
 */
export interface ConfirmOption { value: string; label: string; kind?: 'default' | 'danger' | 'primary' }

interface ConfirmState {
  message: string | null;
  confirmLabel: string;
  options: ConfirmOption[] | null;
  resolveBool: ((ok: boolean) => void) | null;
  resolveValue: ((v: string) => void) | null;
  ask: (message: string, confirmLabel?: string) => Promise<boolean>;
  askOption: (message: string, options: ConfirmOption[]) => Promise<string>;
  answer: (ok: boolean) => void;
  answerValue: (v: string) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  message: null,
  confirmLabel: 'Confirm',
  options: null,
  resolveBool: null,
  resolveValue: null,
  ask: (message, confirmLabel = 'Confirm') =>
    new Promise<boolean>((resolve) => {
      get().resolveBool?.(false); // auto-cancel any pending dialog
      set({ message, confirmLabel, options: null, resolveBool: resolve });
    }),
  askOption: (message, options) =>
    new Promise<string>((resolve) => {
      get().resolveValue?.('__cancel__');
      set({ message, confirmLabel: '', options, resolveValue: resolve });
    }),
  answer: (ok) => {
    get().resolveBool?.(ok);
    set({ message: null, resolveBool: null });
  },
  answerValue: (v) => {
    get().resolveValue?.(v);
    set({ message: null, resolveValue: null });
  },
}));

export function confirmDialog(message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  return useConfirm.getState().ask(message, confirmLabel);
}

export function confirmOptions(message: string, options: ConfirmOption[]): Promise<string> {
  return useConfirm.getState().askOption(message, options);
}
