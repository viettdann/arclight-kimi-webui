import { useAuthStore } from './auth-store';
import { wsClient } from './ws-client';

// Module-level side effect: drives the WS lifecycle off auth status.
// `App.tsx` imports this file once so the subscription installs at boot.

let prevStatus = useAuthStore.getState().status;

const unsubscribe = useAuthStore.subscribe((state) => {
  const next = state.status;
  if (next === prevStatus) return;
  if (next === 'authenticated') {
    wsClient.connect();
  } else if (next === 'unauthenticated') {
    // Idempotent — `clearSession` may already have closed the socket.
    wsClient.close(1000, 'auth-cleared');
  }
  prevStatus = next;
});

/** Disposer for HMR / test teardown. Production callers ignore this. */
export const disposeAuthSubscriber = (): void => unsubscribe();
