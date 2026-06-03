import { create } from 'zustand';
import { useProjectsStore } from './projects-store';

// Shared controller for the "start a new task" flow and its two project modals.
// The flow is identical wherever it's triggered (sidebar "New task", the
// Welcome composer's "Select Project"), so the no-project vs has-project
// branching and the modal open-state live here once. Both modals render a
// single time at the app shell; callers only invoke `launch()`.
interface ProjectLaunchState {
  newProjectOpen: boolean;
  pickerOpen: boolean;
  /**
   * Resolve which project to start in, then act:
   *   - no local projects  → open New Project (create/clone)
   *   - one or more        → open the picker so the user chooses
   * Always opens the picker rather than auto-jumping into a lone project — the
   * trigger's job ("New task", "Select Project") is to let the user pick.
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
    set({ pickerOpen: true });
  },
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  closePicker: () => set({ pickerOpen: false }),
}));
