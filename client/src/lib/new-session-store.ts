import type { ProjectSummary } from 'shared/types';
import { create } from 'zustand';
import { DRAFT_SESSION_PATH, DRAFT_WORKDIR_PARAM, router } from './router';

// Starting a session opens a draft: input only, no DB row. The row is created
// on the first message (`start_session`), so spamming this control just opens
// the same draft route — there are no empty sessions to dedupe or guard against.
interface NewSessionState {
  /**
   * Open the draft composer for a project. The first message creates the row.
   */
  request: (project: ProjectSummary) => void;
}

export const useNewSessionStore = create<NewSessionState>(() => ({
  request: (project) => {
    if (project.origin === 'foreign') return;
    const params = new URLSearchParams({ [DRAFT_WORKDIR_PARAM]: project.workDir });
    void router.navigate(`${DRAFT_SESSION_PATH}?${params}`);
  },
}));
