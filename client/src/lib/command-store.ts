import type { CommandInfo } from 'shared/commands';
import { create } from 'zustand';

// Per-session slash-command catalog reported by the live session over the WS
// (`snapshot` and `commands_available`). In-memory only — the server replays it
// on every reconnect, so there is nothing to persist.
interface CommandState {
  commandsBySession: Record<string, CommandInfo[]>;
  setCommands: (sessionId: string, commands: CommandInfo[]) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  commandsBySession: {},
  setCommands: (sessionId, commands) => {
    set((state) => ({
      commandsBySession: { ...state.commandsBySession, [sessionId]: commands },
    }));
  },
}));
