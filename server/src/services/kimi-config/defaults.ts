import type { KimiConfigRow } from 'shared/types/kimi-config';

export const DEFAULT_KIMI_CONFIG: KimiConfigRow = {
  id: 1,
  defaults: {
    model: 'kimi-code/kimi-for-coding',
    thinking: false,
    yolo: false,
    planMode: false,
    editor: '',
    theme: 'dark',
    showThinkingStream: true,
    skipAfkPromptInjection: false,
    mergeAllAvailableSkills: false,
    extraSkillDirs: [],
    telemetry: true,
  },
  provider: {
    name: 'kimi',
    type: 'kimi',
    baseUrl: 'https://api.kimi.com/coding/v1',
    apiKey: '',
    env: {},
    customHeaders: {},
  },
  models: {
    'kimi-code/kimi-for-coding': {
      provider: 'kimi',
      model: 'kimi-for-coding',
      maxContextSize: 262_144,
      capabilities: ['thinking', 'image_in', 'video_in'],
      displayName: 'Kimi-k2.6',
    },
  },
  services: {
    search: null,
    fetch: null,
  },
  loopControl: {
    maxStepsPerTurn: 100,
    maxRetriesPerStep: 3,
    maxRalphIterations: 0,
    reservedContextSize: 50_000,
    compactionTriggerRatio: 0.85,
  },
  background: {
    maxRunningTasks: 4,
    readMaxBytes: 30_000,
    notificationTailLines: 20,
    notificationTailChars: 3000,
    waitPollIntervalMs: 500,
    workerHeartbeatIntervalMs: 5000,
    workerStaleAfterMs: 15_000,
    killGracePeriodMs: 2000,
    keepAliveOnExit: false,
    agentTaskTimeoutS: 900,
    printWaitCeilingS: 3600,
  },
  notifications: {
    claimStaleAfterMs: 15_000,
  },
  mcpClient: {
    toolCallTimeoutMs: 60_000,
  },
  hooks: [],
  extraTomlOverride: '',
  updatedAt: new Date().toISOString(),
};
