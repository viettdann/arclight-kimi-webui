import { create } from 'zustand';

// Open/closed state of the right sidebar (Todo + Context panels). Not persisted:
// the panel always starts closed when entering a chat. Opening it is a per-view
// action, not a sticky preference, so a session switch or reload never restores
// it open.

interface RightSidebarState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useRightSidebarStore = create<RightSidebarState>((set, get) => ({
  open: false,
  toggle: () => set({ open: !get().open }),
  close: () => set({ open: false }),
}));
