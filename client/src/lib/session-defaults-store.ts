import { APPROVAL_MODES, type ApprovalMode, EFFORT_LEVELS, type EffortLevel } from 'shared/types';
import { create } from 'zustand';
import { getMySettings, getResolvedDefaults, putMySettings } from '../api/config';

const DEBOUNCE_MS = 500;

/** User setting key mapping (matches server USER_SETTING_KEYS). */
const USER_KEYS = {
  approvalMode: 'session_defaults.approval_mode',
  thinking: 'session_defaults.thinking',
  providerId: 'session_defaults.provider_id',
  model: 'session_defaults.model',
  effort: 'session_defaults.effort',
} as const;

type DefaultField = 'approvalMode' | 'thinking' | 'providerId' | 'model' | 'effort';

interface OverrideState {
  approvalMode: boolean;
  thinking: boolean;
  providerId: boolean;
  model: boolean;
  effort: boolean;
}

interface SessionDefaultsState {
  approvalMode: ApprovalMode;
  thinking: boolean;
  providerId: string | null;
  model: string | null;
  effort: EffortLevel | null;
  isUserOverride: OverrideState;
  status: 'idle' | 'loading' | 'ready' | 'error';

  setApprovalMode: (mode: ApprovalMode) => void;
  setThinking: (on: boolean) => void;
  setProviderId: (id: string | null) => void;
  setModel: (model: string | null) => void;
  setEffort: (effort: EffortLevel | null) => void;

  /** Reset deletes the user_settings row so the value cascades. */
  resetApprovalMode: () => void;
  resetThinking: () => void;
  resetProviderId: () => void;
  resetModel: () => void;
  resetEffort: () => void;

  /** Fetch from server. Idempotent — safe to call multiple times. */
  load: () => Promise<void>;
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

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const changes = Object.entries(pending).map(([key, value]) => ({ key, value }));
      pending = {};
      if (changes.length === 0) return;
      void putMySettings(changes).catch(() => {
        // Optimistic — failure surfaces on next load, not inline.
      });
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
    providerId: null,
    model: null,
    effort: null,

    isUserOverride: {
      approvalMode: false,
      thinking: false,
      providerId: false,
      model: false,
      effort: false,
    },

    status: 'idle',

    setApprovalMode: (approvalMode) => {
      if (!isApprovalMode(approvalMode)) return;
      setField('approvalMode', USER_KEYS.approvalMode, approvalMode);
    },

    setThinking: (thinking) => setField('thinking', USER_KEYS.thinking, thinking),

    setProviderId: (providerId) => setField('providerId', USER_KEYS.providerId, providerId),

    setModel: (model) => setField('model', USER_KEYS.model, model),

    setEffort: (effort) => {
      if (!isEffortLevel(effort)) return;
      setField('effort', USER_KEYS.effort, effort);
    },

    resetApprovalMode: () => resetField('approvalMode', USER_KEYS.approvalMode),

    resetThinking: () => resetField('thinking', USER_KEYS.thinking),

    resetProviderId: () => resetField('providerId', USER_KEYS.providerId, null),

    resetModel: () => resetField('model', USER_KEYS.model, null),

    resetEffort: () => resetField('effort', USER_KEYS.effort, null),

    load: async () => {
      set({ status: 'loading' });
      try {
        const [defaults, mySettings] = await Promise.all([getResolvedDefaults(), getMySettings()]);

        const approvalMode = isApprovalMode(defaults.approvalMode) ? defaults.approvalMode : 'ask';
        const thinking = typeof defaults.thinking === 'boolean' ? defaults.thinking : true;
        const providerId = typeof defaults.providerId === 'string' ? defaults.providerId : null;
        const model = typeof defaults.model === 'string' ? defaults.model : null;
        const effort = isEffortLevel(defaults.effort) ? defaults.effort : null;

        set({
          approvalMode,
          thinking,
          providerId,
          model,
          effort,
          isUserOverride: {
            approvalMode: mySettings[USER_KEYS.approvalMode] !== undefined,
            thinking: mySettings[USER_KEYS.thinking] !== undefined,
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
