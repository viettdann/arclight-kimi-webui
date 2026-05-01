import { createAuthClient } from 'better-auth/client';

// BetterAuth client SDK. `baseURL` is the same-origin path the server mounts
// the auth handler under (`/api/auth`). Vite dev server proxies it to the
// backend; in prod the FE is served from the same origin as the API.
export const authClient = createAuthClient({ baseURL: '/api/auth' });

export const { signIn, signOut, getSession } = authClient;
