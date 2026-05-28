import type {
  KimiConfigDTO,
  KimiConfigPatchDTO,
  KimiConfigStatusResponse,
  KimiConfigTestRequest,
  KimiConfigTestResponse,
  ModelEntry,
} from 'shared/types/kimi-config';
import { create } from 'zustand';
import {
  fetchConfig,
  fetchConfigStatus,
  patchConfig,
  revealApiKey as apiRevealApiKey,
  testConfigConnection,
} from '../api/kimi-config';

// Deep partial that preserves array semantics (arrays are replaced wholesale,
// not merged element-by-element).
type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type KimiConfigLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface KimiConfigState {
  config: KimiConfigDTO | null;
  status: KimiConfigStatusResponse | null;
  loadStatus: KimiConfigLoadStatus;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  testResult: KimiConfigTestResponse | null;
  /**
   * When true, the next `save()` sends the in-memory `provider.apiKey`.
   * When false, `provider.apiKey` is sent as `null` (server keeps existing).
   * Reset to false after each successful save.
   */
  replaceKey: boolean;
  loadError: string | null;
  /** Raw apiKey fetched on demand for the "Reveal" toggle. Cleared on load/save. */
  revealedApiKey: string | null;

  /** Fetch once and cache. Idempotent — chat-input mounts call this. */
  ensureLoaded: () => void;
  /** Unconditional reload (config + status). Used by settings shell. */
  load: () => Promise<void>;
  /** Deep-merge into config in-memory; set dirty. No API call. */
  patch: (partial: DeepPartial<KimiConfigDTO>) => void;
  /** Replace config wholesale (e.g. after setting a nullable services slot). */
  setConfig: (next: KimiConfigDTO) => void;
  setReplaceKey: (v: boolean) => void;
  save: () => Promise<{ ok: boolean; error?: string }>;
  discard: () => Promise<void>;
  /** Test using current in-memory provider edits (apiKey=null when !replaceKey). */
  test: () => Promise<void>;
  clearTestResult: () => void;
  /** Fetch raw apiKey from server and cache it locally. */
  revealApiKey: () => Promise<{ ok: boolean; error?: string }>;
  /** Clear the locally cached raw apiKey. */
  hideApiKey: () => void;
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(patch)) return patch as unknown as T;
  if (typeof patch !== 'object' || typeof base !== 'object' || base === null) {
    return patch as unknown as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const current = out[k];
    if (
      v !== null &&
      !Array.isArray(v) &&
      typeof v === 'object' &&
      current !== null &&
      typeof current === 'object'
    ) {
      out[k] = deepMerge(current as object, v as DeepPartial<object>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export const useKimiConfigStore = create<KimiConfigState>((set, get) => ({
  config: null,
  status: null,
  loadStatus: 'idle',
  dirty: false,
  saving: false,
  testing: false,
  testResult: null,
  replaceKey: false,
  loadError: null,
  revealedApiKey: null,

  ensureLoaded: () => {
    if (get().loadStatus !== 'idle') return;
    void get().load();
  },

  load: async () => {
    set({ loadStatus: 'loading', loadError: null });
    try {
      const [config, status] = await Promise.all([fetchConfig(), fetchConfigStatus()]);
      set({
        config,
        status,
        loadStatus: 'ready',
        dirty: false,
        replaceKey: false,
        testResult: null,
        revealedApiKey: null,
      });
    } catch (e) {
      set({
        loadStatus: 'error',
        loadError: e instanceof Error ? e.message : 'Failed to load config',
      });
    }
  },

  patch: (partial) => {
    const current = get().config;
    if (!current) return;
    const next = deepMerge(current, partial);
    set({ config: next, dirty: true });
  },

  setConfig: (next) => {
    set({ config: next, dirty: true });
  },

  setReplaceKey: (v) => {
    set({ replaceKey: v });
  },

  save: async () => {
    const { config, replaceKey } = get();
    if (!config) return { ok: false, error: 'No config loaded' };
    set({ saving: true });
    try {
      const patchPayload: KimiConfigPatchDTO = {
        defaults: config.defaults,
        provider: {
          ...config.provider,
          // apiKey === null tells the server "leave unchanged"
          apiKey: replaceKey ? config.provider.apiKey : null,
        },
        models: config.models,
        services: config.services,
        loopControl: config.loopControl,
        background: config.background,
        notifications: config.notifications,
        mcpClient: config.mcpClient,
        hooks: config.hooks,
        extraTomlOverride: config.extraTomlOverride,
      };
      const updated = await patchConfig(patchPayload);
      const status = await fetchConfigStatus();
      set({
        config: updated,
        status,
        dirty: false,
        replaceKey: false,
        saving: false,
        revealedApiKey: null,
      });
      return { ok: true };
    } catch (e) {
      set({ saving: false });
      return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
    }
  },

  discard: async () => {
    await get().load();
  },

  test: async () => {
    const { config, replaceKey } = get();
    set({ testing: true, testResult: null });
    try {
      // Mirror the save() contract: only send apiKey when the user explicitly
      // typed a new one (Replace mode). Otherwise null → server uses stored.
      const payload: KimiConfigTestRequest = config
        ? {
            provider: {
              ...config.provider,
              apiKey: replaceKey ? config.provider.apiKey : null,
            },
          }
        : {};
      const res = await testConfigConnection(payload);
      set({ testResult: res, testing: false });
    } catch (e) {
      set({
        testResult: { ok: false, error: e instanceof Error ? e.message : 'Test failed' },
        testing: false,
      });
    }
  },

  clearTestResult: () => {
    set({ testResult: null });
  },

  revealApiKey: async () => {
    try {
      const { apiKey } = await apiRevealApiKey();
      set({ revealedApiKey: apiKey });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Reveal failed' };
    }
  },

  hideApiKey: () => {
    set({ revealedApiKey: null });
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
