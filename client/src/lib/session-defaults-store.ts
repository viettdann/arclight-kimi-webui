import { APPROVAL_MODES, type ApprovalMode, EFFORT_LEVELS, type EffortLevel } from 'shared/types';
import { create } from 'zustand';
import { getMySettings, getResolvedDefaults, putMySettings } from '../api/config';
import { saveWithToast } from './save-toast';

const DEBOUNCE_MS = 500;

/** User setting key mapping (matches server USER_SETTING_KEYS). */
const USER_KEYS = {
  approvalMode: 'session_defaults.approval_mode',
  thinking: 'session_defaults.thinking',
  ultracode: 'session_defaults.ultracode',
  providerId: 'session_defaults.provider_id',
  model: 'session_defaults.model',
  effort: 'session_defaults.effort',
} as const;

type DefaultField = 'approvalMode' | 'thinking' | 'ultracode' | 'providerId' | 'model' | 'effort';

interface OverrideState {
  approvalMode: boolean;
  thinking: boolean;
  ultracode: boolean;
  providerId: boolean;
  model: boolean;
  effort: boolean;
}

interface SessionDefaultsState {
  approvalMode: ApprovalMode;
  thinking: boolean;
  ultracode: boolean;
  providerId: string | null;
  model: string | null;
  effort: EffortLevel | null;
  isUserOverride: OverrideState;
  status: 'idle' | 'loading' | 'ready' | 'error';
  saveFailed: boolean;

  setApprovalMode: (mode: ApprovalMode) => void;
  setThinking: (on: boolean) => void;
  setUltracode: (on: boolean) => void;
  setProviderId: (id: string | null) => void;
  setModel: (model: string | null) => void;
  setEffort: (effort: EffortLevel | null) => void;

  /** Reset deletes the user_settings row so the value cascades. */
  resetApprovalMode: () => void;
  resetThinking: () => void;
  resetUltracode: () => void;
  resetProviderId: () => void;
  resetModel: () => void;
  resetEffort: () => void;

  /** Fetch from server. Idempotent — safe to call multiple times. */
  load: () => Promise<void>;
}

// Auto-saves triggered from the chat composer (model/approval/thinking/effort
// pills) must persist silently — the composer flips these constantly and a
// "Saved" toast each time is noise the user neither needs nor asked for. The
// Settings panel still saves through the toast lifecycle (that's where the
// confirmation matters). A module-level depth counter scopes the silent window
// so nested/overlapping calls (e.g. setProviderId + setModel) compose. Saves
// still happen and `saveFailed` is still tracked; only the toast is suppressed.
let silentDepth = 0;

/**
 * Run `fn` with session-defaults saves suppressed from the toast lifecycle.
 * The debounced flush is captured against the current silent state, so call
 * the setters synchronously inside `fn`.
 */
export function withSilentSave<T>(fn: () => T): T {
  silentDepth += 1;
  try {
    return fn();
  } finally {
    silentDepth -= 1;
  }
}

function isApprovalMode(v: unknown): v is ApprovalMode {
  return typeof v === 'string' && (APPROVAL_MODES as readonly string[]).includes(v);
}

function isEffortLevel(v: unknown): v is EffortLevel | null {
  return v === null || (typeof v === 'string' && (EFFORT_LEVELS as readonly string[]).includes(v));
}

export const useSessionDefaultsStore = create<SessionDefaultsState>((set) => {
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: Record<string, unknown> = {};

  function persist(changes: { key: string; value: unknown }[], silent: boolean) {
    if (silent) {
      // Save without the toast lifecycle, but keep tracking save failures so the
      // Settings close-lock / error state still reflects reality.
      void putMySettings(changes).then(
        () => set({ saveFailed: false }),
        () => set({ saveFailed: true }),
      );
      return;
    }
    saveWithToast(() => putMySettings(changes), {
      error: 'Failed to save defaults',
      onSettled: (failed) => set({ saveFailed: failed }),
    });
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    // Capture the silent state at queue time: the chat composer's setters run
    // inside `withSilentSave`, so a flush they schedule must stay silent even
    // though it fires after the synchronous call has returned.
    const silent = silentDepth > 0;
    flushTimer = setTimeout(() => {
      const changes = Object.entries(pending).map(([key, value]) => ({ key, value }));
      pending = {};
      if (changes.length === 0) return;
      persist(changes, silent);
    }, DEBOUNCE_MS);
  }

  /** Update a field, mark it as overridden, and queue an auto-save. */
  function setField<K extends DefaultField>(
    key: K,
    userKey: string,
    value: SessionDefaultsState[K],
  ) {
    set(
      (s) =>
        ({
          ...s,
          [key]: value,
          isUserOverride: { ...s.isUserOverride, [key]: true },
        }) as unknown as SessionDefaultsState,
    );
    pending[userKey] = value;
    scheduleFlush();
  }

  /** Clear override flag and queue a delete. Optionally reset the local value. */
  function resetField<K extends DefaultField>(
    key: K,
    userKey: string,
    fallback?: SessionDefaultsState[K],
  ) {
    set(
      (s) =>
        ({
          ...s,
          ...(fallback !== undefined ? { [key]: fallback } : {}),
          isUserOverride: { ...s.isUserOverride, [key]: false },
        }) as unknown as SessionDefaultsState,
    );
    pending[userKey] = null;
    scheduleFlush();
  }

  return {
    approvalMode: 'ask',
    thinking: true,
    ultracode: false,
    providerId: null,
    model: null,
    effort: null,

    isUserOverride: {
      approvalMode: false,
      thinking: false,
      ultracode: false,
      providerId: false,
      model: false,
      effort: false,
    },

    status: 'idle',
    saveFailed: false,

    setApprovalMode: (approvalMode) => {
      if (!isApprovalMode(approvalMode)) return;
      setField('approvalMode', USER_KEYS.approvalMode, approvalMode);
    },

    setThinking: (thinking) => setField('thinking', USER_KEYS.thinking, thinking),

    setUltracode: (ultracode) => setField('ultracode', USER_KEYS.ultracode, ultracode),

    setProviderId: (providerId) => setField('providerId', USER_KEYS.providerId, providerId),

    setModel: (model) => setField('model', USER_KEYS.model, model),

    setEffort: (effort) => {
      if (!isEffortLevel(effort)) return;
      setField('effort', USER_KEYS.effort, effort);
    },

    resetApprovalMode: () => resetField('approvalMode', USER_KEYS.approvalMode),

    resetThinking: () => resetField('thinking', USER_KEYS.thinking),

    resetUltracode: () => resetField('ultracode', USER_KEYS.ultracode, false),

    resetProviderId: () => resetField('providerId', USER_KEYS.providerId, null),

    resetModel: () => resetField('model', USER_KEYS.model, null),

    resetEffort: () => resetField('effort', USER_KEYS.effort, null),

    load: async () => {
      set({ status: 'loading' });
      try {
        const [defaults, mySettings] = await Promise.all([getResolvedDefaults(), getMySettings()]);

        const approvalMode = isApprovalMode(defaults.approvalMode) ? defaults.approvalMode : 'ask';
        const thinking = typeof defaults.thinking === 'boolean' ? defaults.thinking : true;
        const ultracode = typeof defaults.ultracode === 'boolean' ? defaults.ultracode : false;
        const providerId = typeof defaults.providerId === 'string' ? defaults.providerId : null;
        const model = typeof defaults.model === 'string' ? defaults.model : null;
        const effort = isEffortLevel(defaults.effort) ? defaults.effort : null;

        set({
          approvalMode,
          thinking,
          ultracode,
          providerId,
          model,
          effort,
          isUserOverride: {
            approvalMode: mySettings[USER_KEYS.approvalMode] !== undefined,
            thinking: mySettings[USER_KEYS.thinking] !== undefined,
            ultracode: mySettings[USER_KEYS.ultracode] !== undefined,
            providerId: mySettings[USER_KEYS.providerId] !== undefined,
            model: mySettings[USER_KEYS.model] !== undefined,
            effort: mySettings[USER_KEYS.effort] !== undefined,
          },
          status: 'ready',
        });
      } catch {
        set({ status: 'error' });
      }
    },
  };
});
