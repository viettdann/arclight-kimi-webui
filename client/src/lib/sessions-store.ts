import type { SessionListItem, SessionListResponse } from 'shared/types';
import { create } from 'zustand';
import { authFetch } from './auth-fetch';

interface SessionsState {
  sessions: SessionListItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  fetch: () => Promise<void>;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  status: 'idle',
  error: null,
  fetch: async () => {
    set({ status: 'loading', error: null });
    try {
      const res = await authFetch('/api/sessions');
      if (!res.ok) {
        set({ status: 'error', error: `http_${res.status}` });
        return;
      }
      const body = (await res.json()) as SessionListResponse;
      set({ sessions: body.sessions, status: 'ready', error: null });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'network_error' });
    }
  },
}));

export function groupByProject(sessions: SessionListItem[]): Record<string, SessionListItem[]> {
  const groups: Record<string, SessionListItem[]> = {};
  for (const s of sessions) {
    const key = s.projectName;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  for (const key of Object.keys(groups)) {
    // localeCompare returns 0 for ties → stable across renders (no flicker).
    // ISO-8601 strings compare lexicographically, matching numeric order.
    groups[key]?.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }
  return groups;
}
