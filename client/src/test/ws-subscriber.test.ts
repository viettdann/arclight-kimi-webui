import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture the handlers ws-subscriber registers, without a real socket.
const { on } = vi.hoisted(() => ({
  on: vi.fn<(event: string, handler: (ev: { data: string }) => void) => () => void>(() => () => {}),
}));
vi.mock('@/lib/ws-client', () => ({ wsClient: { on } }));
vi.mock('@/lib/router', () => ({ router: { navigate: vi.fn() } }));
vi.mock('@/components/toast-provider', () => ({ showToast: vi.fn() }));

import { router } from '@/lib/router';
import { showToast } from '@/components/toast-provider';
import { useChatStore } from '@/lib/chat-store';
import { useCommandStore } from '@/lib/command-store';
import { useProjectsStore } from '@/lib/projects-store';
import { useCloneProgressStore } from '@/lib/clone-progress-store';
import '@/lib/ws-subscriber'; // registers wsClient.on('message' | 'open', ...)

// Pull the message handler that ws-subscriber registered on import.
const messageHandler = on.mock.calls.find((c) => c[0] === 'message')![1];

const dispatch = (frame: Record<string, unknown>) =>
  messageHandler({ data: JSON.stringify(frame) });

const cloneFrame = (status: string, extra: Record<string, unknown> = {}) => ({
  type: 'clone_progress',
  sessionId: '',
  seq: 0,
  timestamp: 0,
  payload: {
    cloneId: 'c1',
    projectName: 'demo',
    phase: 'x',
    percent: null,
    status,
    workDir: '/w/demo',
    ...extra,
  },
});

const snapshotPayload = {
  blocks: [],
  totalTokens: 0,
  totalCostUsd: 0,
  title: null,
  pendingPrompt: null,
  thinking: false,
  approvalMode: 'ask',
  effort: null,
  commands: [{ name: 'compact' }],
  live: { turnInProgress: false },
  contextUsage: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useProjectsStore.setState({ projects: [], status: 'idle', error: null, expanded: {} });
  useCommandStore.setState({ commandsBySession: {} });
  useChatStore.setState({ sessions: {} });
  useCloneProgressStore.setState({ byId: {} });
});

describe('ws-subscriber clone_progress routing', () => {
  it('registers a cloning placeholder and records progress', () => {
    dispatch(cloneFrame('cloning'));
    expect(useProjectsStore.getState().projects[0]).toMatchObject({
      name: 'demo',
      status: 'cloning',
    });
    expect(useCloneProgressStore.getState().byId.c1?.status).toBe('cloning');
  });

  it('adds a ready project on completion', () => {
    dispatch(cloneFrame('completed'));
    expect(useProjectsStore.getState().projects[0]).toMatchObject({
      name: 'demo',
      status: 'ready',
    });
  });

  it('drops the project and toasts on failure', () => {
    dispatch(cloneFrame('cloning'));
    dispatch(cloneFrame('failed', { errorCode: 'clone_failed', error: 'boom' }));
    expect(useProjectsStore.getState().projects).toHaveLength(0);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('drops silently on a user cancel (no toast)', () => {
    dispatch(cloneFrame('cloning'));
    dispatch(cloneFrame('failed', { errorCode: 'clone_canceled' }));
    expect(useProjectsStore.getState().projects).toHaveLength(0);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('ws-subscriber session routing', () => {
  it('loads a snapshot into the chat + command stores and navigates', () => {
    dispatch({ type: 'snapshot', sessionId: 's2', seq: 0, timestamp: 0, payload: snapshotPayload });
    expect(useChatStore.getState().sessions.s2).toBeDefined();
    expect(useCommandStore.getState().commandsBySession.s2).toEqual([{ name: 'compact' }]);
    expect(router.navigate).toHaveBeenCalledWith('/session/s2');
  });

  it('routes commands_available into the command store', () => {
    dispatch({
      type: 'commands_available',
      sessionId: 's3',
      seq: 0,
      timestamp: 0,
      payload: { commands: [{ name: 'init' }] },
    });
    expect(useCommandStore.getState().commandsBySession.s3).toEqual([{ name: 'init' }]);
  });

  it('ignores a session-bound frame with no sessionId', () => {
    dispatch({ type: 'snapshot', sessionId: '', seq: 0, timestamp: 0, payload: snapshotPayload });
    expect(useChatStore.getState().sessions).toEqual({});
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('swallows malformed JSON without throwing', () => {
    expect(() => messageHandler({ data: 'not json' })).not.toThrow();
  });
});
