import type {
  GitCredentialCreateRequest,
  GitCredentialDTO,
  GitCredentialTestRequest,
  GitCredentialTestResponse,
  GitCredentialUpdateRequest,
} from 'shared/types';
import { create } from 'zustand';
import {
  createGitCredential,
  deleteGitCredential,
  listGitCredentials,
  testGitCredential,
  updateGitCredential,
} from '../api/git-credentials';

interface GitCredentialsState {
  credentials: GitCredentialDTO[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;

  /** Fetch once and cache. Idempotent. */
  ensureLoaded: () => void;
  /** Unconditional reload of the credential list. */
  load: () => Promise<void>;
  create: (
    body: GitCredentialCreateRequest,
  ) => Promise<{ ok: boolean; error?: string; credential?: GitCredentialDTO }>;
  update: (
    id: string,
    body: GitCredentialUpdateRequest,
  ) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Calls the test endpoint; never throws. */
  test: (body: GitCredentialTestRequest) => Promise<GitCredentialTestResponse>;
}

export const useGitCredentialsStore = create<GitCredentialsState>((set, get) => ({
  credentials: [],
  status: 'idle',
  error: null,

  ensureLoaded: () => {
    if (get().status !== 'idle') return;
    void get().load();
  },

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const { credentials } = await listGitCredentials();
      set({ credentials, status: 'ready', error: null });
    } catch (e) {
      set({
        status: 'error',
        error: e instanceof Error ? e.message : 'Failed to load credentials',
      });
    }
  },

  create: async (body) => {
    try {
      const credential = await createGitCredential(body);
      set((s) => ({ credentials: [...s.credentials, credential] }));
      return { ok: true, credential };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to create credential' };
    }
  },

  update: async (id, body) => {
    try {
      const updated = await updateGitCredential(id, body);
      set((s) => ({
        credentials: s.credentials.map((c) => (c.id === id ? updated : c)),
      }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to update credential' };
    }
  },

  remove: async (id) => {
    try {
      await deleteGitCredential(id);
      set((s) => ({ credentials: s.credentials.filter((c) => c.id !== id) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to remove credential' };
    }
  },

  test: async (body) => {
    try {
      return await testGitCredential(body);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Test failed' };
    }
  },
}));
