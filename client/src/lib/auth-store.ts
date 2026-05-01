import { create } from 'zustand';
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
  lastClearReason: ClearReason | null;
  bootstrap: () => Promise<void>;
  setSession: (user: AuthUser) => void;
  clearSession: (reason: ClearReason) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  lastClearReason: null,

  // `getSession()` always responds 200 — `data` is `null` for unauthenticated
  // requests. Network/CORS failures leave `status: 'unknown'` so the UI can
  // surface a retry path instead of bouncing the user to /login.
  bootstrap: async () => {
    try {
      const res = await getSession();
      const user = (res?.data as { user?: AuthUser } | null)?.user ?? null;
      if (user) {
        set({ status: 'authenticated', user, lastClearReason: null });
      } else {
        set({ status: 'unauthenticated', user: null, lastClearReason: null });
      }
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
    set({ status: 'unauthenticated', user: null, lastClearReason: reason });
  },
}));
