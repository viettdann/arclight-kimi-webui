import type { CloneProgressPayload } from 'shared/types';
import { create } from 'zustand';

// Tracks in-flight (and just-finished) background clones keyed by `cloneId`.
// Fed by `clone_progress` WS frames (see ws-subscriber); read by the new-project
// modal to render a live progress bar. Entries are user-scoped, not session-
// scoped, so they live outside the chat store.
interface CloneProgressState {
  byId: Record<string, CloneProgressPayload>;
  apply: (payload: CloneProgressPayload) => void;
  clear: (cloneId: string) => void;
}

export const useCloneProgressStore = create<CloneProgressState>((set) => ({
  byId: {},
  // Keep only in-flight clones plus the incoming frame. A backgrounded clone's
  // terminal entry is no longer observed by the modal (it closed), so without
  // this it would linger forever; pruning on the next apply bounds `byId` to the
  // number of concurrent clones. The just-applied entry is always kept, so an
  // open modal still observes its own terminal frame.
  apply: (payload) =>
    set((s) => {
      const byId: Record<string, CloneProgressPayload> = {};
      for (const [id, p] of Object.entries(s.byId)) {
        if (p.status === 'cloning') byId[id] = p;
      }
      byId[payload.cloneId] = payload;
      return { byId };
    }),
  clear: (cloneId) =>
    set((s) => {
      if (!(cloneId in s.byId)) return s;
      const { [cloneId]: _dropped, ...rest } = s.byId;
      return { byId: rest };
    }),
}));
