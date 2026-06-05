import { create } from 'zustand';
import { useSessionsStore } from './sessions-store';

// The project the right-side panels (Git) are scoped to when there's no open
// session. Selecting a project in the sidebar sets this so Git can be acted on
// without first opening a chat. Not persisted: a reload starts with nothing
// selected, exactly like the session-derived project did before.
interface ActiveProjectState {
  selectedProjectName: string | null;
  /** Set (or clear with null) the explicitly-selected project. */
  select: (name: string | null) => void;
}

export const useActiveProjectStore = create<ActiveProjectState>((set) => ({
  selectedProjectName: null,
  select: (name) => set({ selectedProjectName: name }),
}));

/** The project an open session belongs to (null when no/unknown session). The
 *  one place that maps a sessionId to its project, so callers don't re-spell the
 *  `sessions.find(...).projectName` lookup and risk drifting from each other. */
export function useSessionProjectName(sessionId: string | undefined): string | null {
  return useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId)?.projectName ?? null);
}

/**
 * The project the right panel is scoped to. An open session is the source of
 * truth (its `projectName` wins so a deep-link or restored session always
 * matches the route); with no session it falls back to the explicitly-selected
 * project. Shared by chat-view, sidebar, right-sidebar, and the Shell header so
 * they never drift to different notions of "the active project".
 */
export function useActiveProjectName(sessionId: string | undefined): string | null {
  const sessionProject = useSessionProjectName(sessionId);
  const selectedProjectName = useActiveProjectStore((s) => s.selectedProjectName);
  return sessionId ? sessionProject : selectedProjectName;
}
