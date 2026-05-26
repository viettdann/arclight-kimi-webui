import { create } from 'zustand';

interface SidebarViewState {
  filesOpen: boolean;
  openFiles: () => void;
  backToTasks: () => void;
}

export const useSidebarViewStore = create<SidebarViewState>((set) => ({
  filesOpen: false,
  openFiles: () => set({ filesOpen: true }),
  backToTasks: () => set({ filesOpen: false }),
}));
