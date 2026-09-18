import { create } from 'zustand';

/**
 * Client-side transfer tracking (UX-01/UX-02): every upload/download shows
 * queued → active → succeeded/skipped/failed, supports retry and cancel.
 * Completed jobs are recorded to the server as metadata only.
 */
export type ItemStatus = 'pending' | 'active' | 'succeeded' | 'skipped' | 'failed' | 'cancelled';
export type JobStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

export interface JobItem { name: string; size?: number; status: ItemStatus; error?: string }
export interface Job { id: string; kind: 'upload' | 'download'; title: string; items: JobItem[]; status: JobStatus; fallbackDownload: boolean }

interface TransferState {
  jobs: Job[];
  panelOpen: boolean;
  startJob: (kind: Job['kind'], title: string, names: Array<{ name: string; size?: number }>, fallbackDownload?: boolean) => string;
  setItem: (jobId: string, index: number, patch: Partial<JobItem>) => void;
  finishJob: (jobId: string, status: JobStatus) => void;
  cancelJob: (jobId: string) => void;
  isCancelled: (jobId: string) => boolean;
  removeJob: (jobId: string) => void;
  setPanelOpen: (open: boolean) => void;
}

let seq = 0;

export const useTransfers = create<TransferState>((set, get) => ({
  jobs: [],
  panelOpen: true,

  startJob: (kind, title, names, fallbackDownload = false) => {
    const id = `job-${Date.now().toString(36)}-${seq++}`;
    set((s) => ({
      panelOpen: true,
      jobs: [
        ...s.jobs,
        { id, kind, title, status: 'running', fallbackDownload, items: names.map((n) => ({ ...n, status: 'pending' })) },
      ],
    }));
    return id;
  },

  setItem: (jobId, index, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? { ...j, items: j.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }
          : j,
      ),
    })),

  finishJob: (jobId, status) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, status } : j)) })),

  cancelJob: (jobId) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? { ...j, status: j.status === 'running' ? 'cancelled' : j.status, items: j.items.map((it) => (it.status === 'pending' || it.status === 'active') ? { ...it, status: 'cancelled' } : it) }
          : j,
      ),
    }));
  },

  isCancelled: (jobId) => get().jobs.find((j) => j.id === jobId)?.status === 'cancelled',

  removeJob: (jobId) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== jobId) })),

  setPanelOpen: (open) => set({ panelOpen: open }),
}));
