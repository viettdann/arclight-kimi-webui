import type { CreateSessionPayload, ProjectSummary, SessionListItem } from 'shared/types';
import { create } from 'zustand';
import { router } from './router';
import { useSessionDefaultsStore } from './session-defaults-store';
import { useSessionsStore } from './sessions-store';
import { sendWS } from './ws-send';

// Guard for `create_session`. A time-based debounce only stops an accidental
// double-click; a user can still spam the control just slower than the window.
// Two rules instead:
//   1. While a project already has a blank, never-used session, the control
//      focuses it rather than spawning another empty one.
//   2. While a create is in flight (sent, not yet landed in the list), further
//      creates on that project are dropped — covers the window before rule 1
//      can see the new session.

// Auto-clear a stuck in-flight flag if the server never produces the session
// (e.g. create failed server-side). The list refreshes on a 500ms debounce
// after `session_created`, so normal completion clears well under this.
const SAFETY_MS = 8000;

interface NewSessionState {
  /** projectName → a `create_session` is in flight for this project. */
  pending: Record<string, boolean>;
  /**
   * Focus this project's existing blank session, or fire `create_session` if
   * none exists and none is already in flight. Spamming the control cannot
   * spawn duplicate empty sessions.
   */
  request: (project: ProjectSummary) => void;
}

// projectName → session count captured at request time. Internal, not reactive.
const baseline = new Map<string, number>();
// projectName → safety timer handle.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** A session that was created but never used: no title, no tokens. */
function isUnused(s: SessionListItem): boolean {
  return s.title === null && s.totalTokens === 0;
}

function existingUnused(projectName: string): SessionListItem | undefined {
  return useSessionsStore
    .getState()
    .sessions.find((s) => s.projectName === projectName && isUnused(s));
}

function sessionCount(projectName: string): number {
  return useSessionsStore.getState().sessions.filter((s) => s.projectName === projectName).length;
}

function clearPending(name: string): void {
  const t = timers.get(name);
  if (t) {
    clearTimeout(t);
    timers.delete(name);
  }
  baseline.delete(name);
  useNewSessionStore.setState((s) => {
    if (!s.pending[name]) return s;
    const rest = { ...s.pending };
    delete rest[name];
    return { pending: rest };
  });
}

export const useNewSessionStore = create<NewSessionState>((set, get) => ({
  pending: {},
  request: (project) => {
    if (project.origin === 'foreign') return;
    const name = project.name;

    // A blank session already exists here → focus it, don't spawn another.
    const blank = existingUnused(name);
    if (blank) {
      void router.navigate(`/session/${blank.id}`);
      return;
    }

    if (get().pending[name]) return; // create already in flight for this project

    baseline.set(name, sessionCount(name));
    timers.set(
      name,
      setTimeout(() => clearPending(name), SAFETY_MS),
    );
    set((s) => ({ pending: { ...s.pending, [name]: true } }));

    // Seed the new session from the user's Session Defaults (approval/thinking).
    // model and providerId are omitted — the server fills them via defaultSelectionForUser.
    const { approvalMode, thinking } = useSessionDefaultsStore.getState();
    const payload: CreateSessionPayload = { workDir: project.workDir, approvalMode, thinking };
    sendWS('create_session', payload);
  },
}));

// Clear a project's in-flight flag once its session list grows past the
// baseline captured at request time — the freshly created session has landed.
useSessionsStore.subscribe((state) => {
  if (baseline.size === 0) return;
  for (const [name, base] of baseline) {
    const count = state.sessions.filter((s) => s.projectName === name).length;
    if (count > base) clearPending(name);
  }
});
