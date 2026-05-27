import type { KimiConfigDTO, ModelEntry } from 'shared/types/kimi-config';
import { create } from 'zustand';
import { fetchConfig } from '../api/kimi-config';

interface KimiConfigState {
  config: KimiConfigDTO | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Fetch once and cache. Safe to call on every mount — a no-op after the first. */
  ensureLoaded: () => void;
}

export const useKimiConfigStore = create<KimiConfigState>((set, get) => ({
  config: null,
  status: 'idle',

  ensureLoaded: () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    fetchConfig()
      .then((config) => set({ config, status: 'ready' }))
      .catch(() => set({ status: 'error' }));
  },
}));

/**
 * Resolve the model shown in the composer. `sessionModel` wins when set, else
 * the configured default. Returns the display label plus thinking capability so
 * the composer can render the name and decide whether thinking is forced on.
 */
export function resolveModel(
  config: KimiConfigDTO | null,
  sessionModel: string | null,
): { label: string | null; entry: ModelEntry | null; alwaysThinking: boolean } {
  if (!config) return { label: sessionModel, entry: null, alwaysThinking: false };
  const modelId = sessionModel ?? config.defaults.model;
  const entry = (modelId && config.models[modelId]) || null;
  const label = entry?.displayName ?? modelId ?? null;
  const alwaysThinking = entry?.capabilities.includes('always_thinking') ?? false;
  return { label, entry, alwaysThinking };
}
