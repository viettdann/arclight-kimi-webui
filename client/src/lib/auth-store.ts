import { create } from 'zustand';
import { getSession } from './auth-client';
import { router } from './router';
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
  bootstrap: () => Promise<void>;
  setSession: (user: AuthUser) => void;
  clearSession: (reason: ClearReason) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,

  // `getSession()` always responds 200 — `data` is `null` for unauthenticated
  // requests. Network/CORS failures leave `status: 'unknown'` so the UI can
  // surface a retry path instead of bouncing the user to /login.
  bootstrap: async () => {
    try {
      const res = await getSession();
      const user = (res?.data as { user?: AuthUser } | null)?.user ?? null;
      if (user) {
        set({ status: 'authenticated', user });
      } else {
        set({ status: 'unauthenticated', user: null });
      }
    } catch {
      // keep status: 'unknown'
    }
  },

  setSession: (user) => {
    set({ status: 'authenticated', user });
  },

  clearSession: (reason) => {
    // Audit trail — distinguishes server-driven (`ws-4401`, `rest-401`) from
    // user-driven (`manual`) logouts when triaging support reports.
    if (typeof console !== 'undefined') console.info('[auth] clearSession', reason);
    // Order matters: stop the socket first so reconnect logic doesn't race
    // a follow-up `connect` from the auth-subscriber. Code 1000 is benign.
    wsClient.close(1000, reason);
    set({ status: 'unauthenticated', user: null });
    // `router.navigate` is available on the data router instance returned
    // by `createBrowserRouter`. `replace: true` keeps /login out of history.
    router.navigate('/login', { replace: true });
  },
}));
