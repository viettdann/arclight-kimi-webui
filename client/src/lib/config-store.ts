import type { ConfigSettingDTO, ConfigTestResponse } from 'shared/types/config';
import { create } from 'zustand';
import { fetchConfig, patchConfig, testConfig } from '../api/config';

export type ConfigLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Selectable Claude models for the default-model picker and composer label. */
export const MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

const FALLBACK_MODEL: { id: string; label: string } = MODELS.find(
  (m) => m.id === 'claude-sonnet-4-6',
) ?? { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' };

interface ConfigState {
  /** Server settings keyed by config key, as last loaded/saved. */
  settings: Record<string, ConfigSettingDTO>;
  /**
   * Pending edits keyed by setting key. `value` is the new string to send;
   * `null` means "leave unchanged" (used to keep an existing secret). Absent
   * keys are unchanged. Cleared on load/save/discard.
   */
  drafts: Record<string, string | null>;
  loadStatus: ConfigLoadStatus;
  loadError: string | null;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  testResult: ConfigTestResponse | null;

  /** Fetch once and cache. Idempotent — composer mounts call this. */
  ensureLoaded: () => void;
  /** Unconditional reload. Used by the settings shell. */
  load: () => Promise<void>;
  /** Stage an edit for a single key. `null` keeps the existing (secret) value. */
  setDraft: (key: string, value: string | null) => void;
  /** Drop a staged edit for a single key (revert to loaded value). */
  clearDraft: (key: string) => void;
  /** Read the effective string value for a key (draft wins, else loaded). */
  getValue: (key: string) => string;
  save: () => Promise<{ ok: boolean; error?: string }>;
  discard: () => Promise<void>;
  test: () => Promise<void>;
  clearTestResult: () => void;
}

function indexSettings(settings: ConfigSettingDTO[]): Record<string, ConfigSettingDTO> {
  const out: Record<string, ConfigSettingDTO> = {};
  for (const s of settings) out[s.key] = s;
  return out;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  settings: {},
  drafts: {},
  loadStatus: 'idle',
  loadError: null,
  dirty: false,
  saving: false,
  testing: false,
  testResult: null,

  ensureLoaded: () => {
    if (get().loadStatus !== 'idle') return;
    void get().load();
  },

  load: async () => {
    set({ loadStatus: 'loading', loadError: null });
    try {
      const { settings } = await fetchConfig();
      set({
        settings: indexSettings(settings),
        drafts: {},
        loadStatus: 'ready',
        dirty: false,
        testResult: null,
      });
    } catch (e) {
      set({
        loadStatus: 'error',
        loadError: e instanceof Error ? e.message : 'Failed to load config',
      });
    }
  },

  setDraft: (key, value) => {
    const drafts = { ...get().drafts, [key]: value };
    set({ drafts, dirty: true });
  },

  clearDraft: (key) => {
    if (!(key in get().drafts)) return;
    const drafts = { ...get().drafts };
    delete drafts[key];
    set({ drafts, dirty: Object.keys(drafts).length > 0 });
  },

  getValue: (key) => {
    const draft = get().drafts[key];
    if (draft !== undefined) return draft ?? get().settings[key]?.value ?? '';
    return get().settings[key]?.value ?? '';
  },

  save: async () => {
    const { drafts } = get();
    const keys = Object.keys(drafts);
    if (keys.length === 0) return { ok: true };
    set({ saving: true });
    try {
      const { settings } = await patchConfig({
        settings: keys.map((key) => ({ key, value: drafts[key] ?? null })),
      });
      set({
        settings: indexSettings(settings),
        drafts: {},
        dirty: false,
        saving: false,
        testResult: null,
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
    set({ testing: true, testResult: null });
    try {
      const res = await testConfig();
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
}));

/**
 * Resolve the model shown in the composer. `sessionModel` wins when it names a
 * known model, else the configured `DEFAULT_MODEL`, else a hard fallback. All
 * Claude models support thinking.
 */
export function resolveModel(sessionModel?: string | null): {
  id: string;
  label: string;
  supportsThinking: boolean;
} {
  const sessionMatch = sessionModel ? MODELS.find((m) => m.id === sessionModel) : undefined;
  if (sessionMatch) return { ...sessionMatch, supportsThinking: true };

  const defaultId = useConfigStore.getState().getValue('DEFAULT_MODEL');
  const defaultMatch = defaultId ? MODELS.find((m) => m.id === defaultId) : undefined;
  if (defaultMatch) return { ...defaultMatch, supportsThinking: true };

  return { ...FALLBACK_MODEL, supportsThinking: true };
}
