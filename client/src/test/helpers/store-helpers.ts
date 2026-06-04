/**
 * Helpers to set up Zustand stores for testing.
 * Each helper resets stores to a known state so tests are isolated.
 */
import type { SessionListItem } from 'shared/types';
import { type AuthUser, useAuthStore } from '../../lib/auth-store';
import { useChatStore } from '../../lib/chat-store';
import { useProjectsStore } from '../../lib/projects-store';
import { useProvidersStore } from '../../lib/providers-store';
import { useSessionsStore } from '../../lib/sessions-store';
import { makeAuthUser } from './factories';

/** Reset all relevant stores to a clean unauthenticated state. */
export function setupUnauthenticatedStores() {
  useAuthStore.setState({
    status: 'unauthenticated',
    user: null,
    allowed: null,
    lastClearReason: null,
  });
  useProjectsStore.setState({ projects: [], status: 'idle', error: null, expanded: {} });
  useSessionsStore.setState({ sessions: [], status: 'idle', error: null });
  useChatStore.setState({ sessions: {} });
}

/**
 * Set up stores for an authenticated user with default provider catalog.
 * Accepts overrides for auth user and optional project/session data.
 */
export function setupAuthenticatedStores(opts?: {
  user?: Partial<AuthUser>;
  allowed?: boolean;
  projects?: ReturnType<typeof useProjectsStore.getState>['projects'];
  sessions?: SessionListItem[];
}) {
  const user = makeAuthUser(opts?.user);
  useAuthStore.setState({
    status: 'authenticated',
    user,
    allowed: opts?.allowed ?? true,
    lastClearReason: null,
  });
  useProjectsStore.setState({
    projects: opts?.projects ?? [],
    status: 'ready',
    error: null,
    expanded: {},
  });
  useSessionsStore.setState({
    sessions: opts?.sessions ?? [],
    status: 'ready',
    error: null,
  });
  useChatStore.setState({ sessions: {} });

  // Providers store — set to ready with empty catalog by default.
  useProvidersStore.setState({
    available: { builtin: [], personal: [] },
    status: 'ready',
    error: null,
  });
}

/**
 * Set up stores as "unknown" auth status (simulating the bootstrap window).
 */
export function setupUnknownAuthStores() {
  useAuthStore.setState({
    status: 'unknown',
    user: null,
    allowed: null,
    lastClearReason: null,
  });
}
