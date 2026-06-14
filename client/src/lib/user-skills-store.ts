import type { CommandInfo } from 'shared/commands';
import type { SkillDTO } from 'shared/types/skills';
import { create } from 'zustand';
import { listSkills } from '../api/skills';

// The user's enabled skills, preloaded as picker catalog entries (kind='skill')
// independently of any session. This is what lets the composer show `/skill`
// commands before the first turn spawns a subprocess — the per-user skill set
// lives in the database, so it needs no live session to enumerate. A live
// session's authoritative `commands_available` catalog overrides these by name
// once it arrives (see the merge in chat-input).

interface UserSkillsState {
  skills: CommandInfo[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Fetch once and cache. Idempotent. */
  ensureLoaded: () => void;
  /** Unconditional reload from the server. */
  load: () => Promise<void>;
  /** Re-derive from an already-fetched list, avoiding a second request. */
  setFromList: (skills: SkillDTO[]) => void;
}

/** Enabled skills only — disabled ones never materialize for a session. */
function deriveEnabled(skills: SkillDTO[]): CommandInfo[] {
  return skills
    .filter((s) => s.enabled)
    .map((s) => ({
      name: s.name,
      description: s.description,
      argumentHint: '',
      kind: 'skill' as const,
    }));
}

export const useUserSkillsStore = create<UserSkillsState>((set, get) => ({
  skills: [],
  status: 'idle',

  ensureLoaded: () => {
    if (get().status !== 'idle') return;
    void get().load();
  },

  load: async () => {
    set({ status: 'loading' });
    try {
      set({ skills: deriveEnabled(await listSkills()), status: 'ready' });
    } catch {
      // Leave any previously loaded skills in place; a failed refresh must not
      // empty the picker.
      set({ status: 'error' });
    }
  },

  setFromList: (skills) => set({ skills: deriveEnabled(skills), status: 'ready' }),
}));
