import { create } from 'zustand';
import { useNewSessionStore } from './new-session-store';
import { useProjectsStore } from './projects-store';

// Shared controller for the "start a new task" flow and its two project modals.
// The flow is identical wherever it's triggered (sidebar "New task", the
// Welcome composer's project picker), so the 0/1/≥2-project branching and the
// modal open-state live here once. Both modals render a single time at the app
// shell; callers only invoke `launch()`.
interface ProjectLaunchState {
  newProjectOpen: boolean;
  pickerOpen: boolean;
  /**
   * Resolve which project to start in, then act:
   *   - no local projects  → open New Project (create/clone)
   *   - exactly one        → open its draft composer straight away
   *   - more than one      → open the picker
   * Auth is the caller's concern (starting a task needs an account); call this
   * only once signed in. `onNoLocalProjects` lets the caller surface a hint
   * (toast) in that branch.
   */
  launch: (opts?: { onNoLocalProjects?: (hasForeign: boolean) => void }) => void;
  openNewProject: () => void;
  closeNewProject: () => void;
  closePicker: () => void;
}

export const useProjectLaunchStore = create<ProjectLaunchState>((set) => ({
  newProjectOpen: false,
  pickerOpen: false,
  launch: (opts) => {
    const list = useProjectsStore.getState().projects;
    const locals = list.filter((p) => p.origin === 'local');
    const hasForeign = list.some((p) => p.origin === 'foreign');
    if (locals.length === 0) {
      set({ newProjectOpen: true });
      opts?.onNoLocalProjects?.(hasForeign);
      return;
    }
    if (locals.length === 1) {
      const only = locals[0];
      if (only) useNewSessionStore.getState().request(only);
      return;
    }
    set({ pickerOpen: true });
  },
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  closePicker: () => set({ pickerOpen: false }),
}));
