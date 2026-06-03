import { create } from 'zustand';

interface SidebarViewState {
  filesOpen: boolean;
  filesProjectName: string | null;
  openFiles: (projectName: string) => void;
  backToTasks: () => void;
}

export const useSidebarViewStore = create<SidebarViewState>((set) => ({
  filesOpen: false,
  filesProjectName: null,
  openFiles: (projectName: string) => set({ filesOpen: true, filesProjectName: projectName }),
  backToTasks: () => set({ filesOpen: false, filesProjectName: null }),
}));
