import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as configApi from '@/api/config';
import { useSessionDefaultsStore } from '@/lib/session-defaults-store';

vi.mock('@/api/config', () => ({
  getResolvedDefaults: vi.fn(),
  getMySettings: vi.fn(),
  putMySettings: vi.fn(),
}));

describe('useSessionDefaultsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionDefaultsStore.setState({
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
    });
  });

  it('has correct initial state', () => {
    const s = useSessionDefaultsStore.getState();
    expect(s.approvalMode).toBe('ask');
    expect(s.thinking).toBe(true);
    expect(s.providerId).toBeNull();
    expect(s.model).toBeNull();
    expect(s.effort).toBeNull();
    expect(s.status).toBe('idle');
  });

  it('setApprovalMode updates state and marks override', () => {
    useSessionDefaultsStore.getState().setApprovalMode('bypass');
    const s = useSessionDefaultsStore.getState();
    expect(s.approvalMode).toBe('bypass');
    expect(s.isUserOverride.approvalMode).toBe(true);
  });

  it('setThinking updates state and marks override', () => {
    useSessionDefaultsStore.getState().setThinking(false);
    const s = useSessionDefaultsStore.getState();
    expect(s.thinking).toBe(false);
    expect(s.isUserOverride.thinking).toBe(true);
  });

  it('setProviderId and setModel update state and mark overrides', () => {
    useSessionDefaultsStore.getState().setProviderId('p1');
    useSessionDefaultsStore.getState().setModel('m1');
    const s = useSessionDefaultsStore.getState();
    expect(s.providerId).toBe('p1');
    expect(s.model).toBe('m1');
    expect(s.isUserOverride.providerId).toBe(true);
    expect(s.isUserOverride.model).toBe(true);
  });

  it('setEffort updates state and marks override', () => {
    useSessionDefaultsStore.getState().setEffort('high');
    const s = useSessionDefaultsStore.getState();
    expect(s.effort).toBe('high');
    expect(s.isUserOverride.effort).toBe(true);
  });

  it('resetApprovalMode clears override', () => {
    useSessionDefaultsStore.getState().setApprovalMode('bypass');
    useSessionDefaultsStore.getState().resetApprovalMode();
    const s = useSessionDefaultsStore.getState();
    expect(s.isUserOverride.approvalMode).toBe(false);
  });

  it('resetThinking clears override', () => {
    useSessionDefaultsStore.getState().setThinking(false);
    useSessionDefaultsStore.getState().resetThinking();
    const s = useSessionDefaultsStore.getState();
    expect(s.isUserOverride.thinking).toBe(false);
  });

  it('load fetches defaults and my settings', async () => {
    vi.mocked(configApi.getResolvedDefaults).mockResolvedValue({
      approvalMode: 'safe',
      thinking: false,
      providerId: 'p1',
      model: 'm1',
      effort: 'low',
    });
    vi.mocked(configApi.getMySettings).mockResolvedValue({
      'session_defaults.approval_mode': 'safe',
      'session_defaults.thinking': false,
    });

    await useSessionDefaultsStore.getState().load();

    const s = useSessionDefaultsStore.getState();
    expect(s.status).toBe('ready');
    expect(s.approvalMode).toBe('safe');
    expect(s.thinking).toBe(false);
    expect(s.providerId).toBe('p1');
    expect(s.model).toBe('m1');
    expect(s.effort).toBe('low');
    expect(s.isUserOverride.approvalMode).toBe(true);
    expect(s.isUserOverride.thinking).toBe(true);
    expect(s.isUserOverride.providerId).toBe(false);
    expect(s.isUserOverride.model).toBe(false);
    expect(s.isUserOverride.effort).toBe(false);
  });

  it('load falls back on error', async () => {
    vi.mocked(configApi.getResolvedDefaults).mockRejectedValue(new Error('network'));
    vi.mocked(configApi.getMySettings).mockRejectedValue(new Error('network'));

    await useSessionDefaultsStore.getState().load();

    const s = useSessionDefaultsStore.getState();
    expect(s.status).toBe('error');
  });
});
