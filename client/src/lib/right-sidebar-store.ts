import { create } from 'zustand';

// Open/closed state of the right sidebar (Todo + Context panels). Persisted to
// localStorage so it survives reloads. When no value has been persisted we
// default closed — the safe default on mobile, where the sidebar is an overlay.
const STORAGE_KEY = 'rightSidebarOpen';

function load(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

function persist(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    // localStorage unavailable — keep in-memory only.
  }
}

interface RightSidebarState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useRightSidebarStore = create<RightSidebarState>((set, get) => ({
  open: load(),
  toggle: () => {
    const open = !get().open;
    set({ open });
    persist(open);
  },
  close: () => {
    set({ open: false });
    persist(false);
  },
}));
