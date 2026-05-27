import { create } from 'zustand';

// Per-session composer drafts. Keyed by sessionId so switching sessions shows
// that session's in-progress text (or empty when none), and persisted to
// localStorage so a reload never loses what was being typed.
const DRAFTS_KEY = 'composerDrafts';

function loadDrafts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}

function persistDrafts(drafts: Record<string, string>): void {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // localStorage unavailable (private mode / quota) — keep in-memory only.
  }
}

interface DraftState {
  drafts: Record<string, string>;
  setDraft: (sessionId: string, text: string) => void;
  clearDraft: (sessionId: string) => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: loadDrafts(),
  setDraft: (sessionId, text) => {
    const drafts = { ...get().drafts };
    // Empty draft carries no information — drop the key to keep storage lean.
    if (text) drafts[sessionId] = text;
    else delete drafts[sessionId];
    persistDrafts(drafts);
    set({ drafts });
  },
  clearDraft: (sessionId) => {
    const drafts = { ...get().drafts };
    delete drafts[sessionId];
    persistDrafts(drafts);
    set({ drafts });
  },
}));
