import { create } from 'zustand';
import { fetchMe } from '../api/me';
import { getSession } from './auth-client';
import { wsClient } from './ws-client';

// Minimal client-side projection of the BetterAuth user record. Field set
// matches the columns the server populates plus the custom `role`.
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: 'admin' | 'user';
}

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';
export type ClearReason = 'rest-401' | 'ws-4401' | 'manual';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /**
   * Whether the user may use the app per the allowlist gate. `null` until
   * resolved (or when no session). `false` → Coming Soon. Written together
   * with `status` in `bootstrap`, so the WS gate sees a single transition.
   */
  allowed: boolean | null;
  lastClearReason: ClearReason | null;
  bootstrap: () => Promise<void>;
  setSession: (user: AuthUser) => void;
  clearSession: (reason: ClearReason) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  allowed: null,
  lastClearReason: null,

  // `getSession()` always responds 200 — `data` is `null` for unauthenticated
  // requests. When a user exists, `/api/me` resolves their role + allowlist
  // status; status and `allowed` are then set in one update. Network/CORS
  // failures (including a /api/me failure) leave `status: 'unknown'` so the UI
  // can surface a retry path instead of bouncing the user to /login. A 401
  // from /api/me is handled by `authFetch` → `clearSession`.
  bootstrap: async () => {
    try {
      const res = await getSession();
      const user = (res?.data as { user?: AuthUser } | null)?.user ?? null;
      if (!user) {
        set({ status: 'unauthenticated', user: null, allowed: null, lastClearReason: null });
        return;
      }
      const me = await fetchMe();
      // The session may have been torn down (manual sign-out, WS 4401) while
      // /api/me was in flight; honor that clear instead of re-authenticating.
      if (get().status === 'unauthenticated') return;
      set({
        status: 'authenticated',
        user: { ...user, role: me.role },
        allowed: me.allowed,
        lastClearReason: null,
      });
    } catch {
      // keep status: 'unknown'
    }
  },

  setSession: (user) => {
    set({ status: 'authenticated', user, lastClearReason: null });
  },

  clearSession: (reason) => {
    if (typeof console !== 'undefined') console.info('[auth] clearSession', reason);
    wsClient.close(1000, reason);
    set({ status: 'unauthenticated', user: null, allowed: null, lastClearReason: reason });
  },
}));
