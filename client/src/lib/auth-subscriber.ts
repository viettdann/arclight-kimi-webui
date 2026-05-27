import { type AuthState, useAuthStore } from './auth-store';
import { wsClient } from './ws-client';

// Module-level side effect: drives the WS lifecycle off auth status.
// `App.tsx` imports this file once so the subscription installs at boot.

// Connect only once the user is both authenticated AND allowed. A pending
// (allowed === false) user that connected would hit the WS-upgrade 403 and
// reconnect-loop on the unknown close code.
const canConnect = (s: AuthState): boolean => s.status === 'authenticated' && s.allowed === true;

let prev = canConnect(useAuthStore.getState());

const unsubscribe = useAuthStore.subscribe((state) => {
  const next = canConnect(state);
  if (next === prev) return;
  if (next) {
    wsClient.connect();
  } else {
    // Idempotent — `clearSession` may already have closed the socket.
    wsClient.close(1000, 'auth-cleared');
  }
  prev = next;
});

/** Disposer for HMR / test teardown. Production callers ignore this. */
export const disposeAuthSubscriber = (): void => unsubscribe();
