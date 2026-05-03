import { createAuthClient } from 'better-auth/client';

// BetterAuth requires an absolute URL with protocol; derive it from the
// current origin so dev (Vite proxy on :5173) and prod (same-origin) both work.
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
});

export const { signIn, signOut, getSession } = authClient;
