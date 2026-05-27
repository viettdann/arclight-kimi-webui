import { create } from 'zustand';

const WIDTH_KEY = 'editorWidthPct';
const DEFAULT_WIDTH_PCT = 57;

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw === null) return DEFAULT_WIDTH_PCT;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_WIDTH_PCT;
  } catch {
    return DEFAULT_WIDTH_PCT;
  }
}

interface OpenFile {
  path: string;
  name: string;
}

/** A close/switch the editor declined because the buffer has unsaved edits. */
type Pending = { kind: 'close' } | { kind: 'switch'; file: OpenFile };

interface OpenFileState {
  openFile: OpenFile | null;
  /**
   * The intended next state, stashed when a close/switch was blocked by unsaved
   * edits, so the editor can show a confirm dialog and resolve it.
   */
  pending: Pending | null;
  editorWidthPct: number;
  /** True when the open buffer has unsaved edits; the editor keeps this in sync. */
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  open: (path: string, name: string) => void;
  close: () => void;
  /** Resolve a pending close/switch (after the user confirms discard). */
  confirmPending: () => void;
  /** Dismiss a pending close/switch (user kept editing). */
  cancelPending: () => void;
  setWidth: (pct: number) => void;
}

export const useOpenFileStore = create<OpenFileState>((set, get) => ({
  openFile: null,
  pending: null,
  editorWidthPct: loadWidth(),
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
  open: (path, name) => {
    const { openFile, dirty } = get();
    const next = { path, name };
    // No-op when re-opening the same file.
    if (openFile?.path === path) return;
    // Guard switching away from a dirty buffer.
    if (openFile != null && dirty) {
      set({ pending: { kind: 'switch', file: next } });
      return;
    }
    set({ openFile: next, pending: null, dirty: false });
  },
  close: () => {
    if (get().dirty) {
      set({ pending: { kind: 'close' } });
      return;
    }
    set({ openFile: null, pending: null, dirty: false });
  },
  confirmPending: () => {
    const { pending } = get();
    const next = pending?.kind === 'switch' ? pending.file : null;
    set({ openFile: next, pending: null, dirty: false });
  },
  cancelPending: () => set({ pending: null }),
  // In-memory only; called at pointer-move frequency during a drag. Persist
  // once at the end of the gesture via `persistWidth` to avoid sync I/O churn.
  setWidth: (pct) => set({ editorWidthPct: pct }),
}));

/** Persist the current editor width to localStorage. Call once per gesture. */
export function persistWidth(pct: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(pct));
  } catch {
    // localStorage unavailable (private mode / quota) — keep in-memory only.
  }
}
