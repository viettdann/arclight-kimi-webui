import { APPROVAL_MODES, type ApprovalMode } from 'shared/types';
import { create } from 'zustand';

// Client-side defaults applied when starting a new session. Persisted to
// localStorage so they survive reloads. These are not server config keys.
const STORAGE_KEY = 'sessionDefaults';

interface PersistedDefaults {
  approvalMode: ApprovalMode;
  thinking: boolean;
}

const FALLBACK: PersistedDefaults = { approvalMode: 'ask', thinking: false };

function isApprovalMode(v: unknown): v is ApprovalMode {
  return typeof v === 'string' && (APPROVAL_MODES as readonly string[]).includes(v);
}

function load(): PersistedDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...FALLBACK };
    const parsed = JSON.parse(raw) as Partial<PersistedDefaults>;
    return {
      approvalMode: isApprovalMode(parsed.approvalMode)
        ? parsed.approvalMode
        : FALLBACK.approvalMode,
      thinking: typeof parsed.thinking === 'boolean' ? parsed.thinking : FALLBACK.thinking,
    };
  } catch {
    return { ...FALLBACK };
  }
}

function persist(state: PersistedDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable — keep in-memory only.
  }
}

interface SessionDefaultsState extends PersistedDefaults {
  setApprovalMode: (mode: ApprovalMode) => void;
  setThinking: (on: boolean) => void;
}

export const useSessionDefaultsStore = create<SessionDefaultsState>((set, get) => ({
  ...load(),
  setApprovalMode: (approvalMode) => {
    set({ approvalMode });
    persist({ approvalMode, thinking: get().thinking });
  },
  setThinking: (thinking) => {
    set({ thinking });
    persist({ approvalMode: get().approvalMode, thinking });
  },
}));
