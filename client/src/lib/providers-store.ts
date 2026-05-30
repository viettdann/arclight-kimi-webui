import type { AvailableProvidersResponse } from 'shared/types/providers';
import { create } from 'zustand';
import { fetchAvailableProviders } from '../api/providers';

interface ProvidersState {
  available: AvailableProvidersResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;

  /** Fetch once and cache. Idempotent. */
  ensureLoaded: () => void;
  /** Unconditional reload of the available catalog. */
  load: () => Promise<void>;
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  available: null,
  status: 'idle',
  error: null,

  ensureLoaded: () => {
    if (get().status !== 'idle') return;
    void get().load();
  },

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const available = await fetchAvailableProviders();
      set({ available, status: 'ready', error: null });
    } catch (e) {
      set({
        status: 'error',
        error: e instanceof Error ? e.message : 'Failed to load providers',
      });
    }
  },
}));

/**
 * Find a human-readable label for a (providerId, modelId) pair.
 * Returns `"namespace/displayName"` when the pair resolves; null otherwise.
 * Call with the store's `available` snapshot — does not subscribe.
 */
export function labelFor(
  available: AvailableProvidersResponse | null,
  providerId: string | null,
  modelId: string | null,
): string | null {
  if (!available || !providerId || !modelId) return null;
  const all = [...available.builtin, ...available.personal];
  const provider = all.find((p) => p.id === providerId);
  if (!provider) return null;
  const model = provider.models.find((m) => m.modelId === modelId);
  if (!model) return null;
  return `${provider.namespace}/${model.displayName ?? model.modelId}`;
}

/**
 * True when the (providerId, modelId) pair exists in the available catalog.
 * Call with the store's `available` snapshot — does not subscribe.
 */
export function isResolvable(
  available: AvailableProvidersResponse | null,
  providerId: string | null,
  modelId: string | null,
): boolean {
  return labelFor(available, providerId, modelId) !== null;
}
