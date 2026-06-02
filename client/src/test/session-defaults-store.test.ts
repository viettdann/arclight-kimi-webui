import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionDefaultsStore } from '@/lib/session-defaults-store';

const STORAGE_KEY = 'sessionDefaults';

describe('useSessionDefaultsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to the module's documented fallback.
    useSessionDefaultsStore.setState({ approvalMode: 'ask', thinking: false });
  });

  it('setApprovalMode updates state and persists both fields', () => {
    useSessionDefaultsStore.getState().setApprovalMode('bypass');
    expect(useSessionDefaultsStore.getState().approvalMode).toBe('bypass');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      approvalMode: 'bypass',
      thinking: false,
    });
  });

  it('setThinking updates state and persists both fields', () => {
    useSessionDefaultsStore.getState().setThinking(true);
    expect(useSessionDefaultsStore.getState().thinking).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      approvalMode: 'ask',
      thinking: true,
    });
  });

  it('persists the combined snapshot when both are changed', () => {
    useSessionDefaultsStore.getState().setApprovalMode('safe');
    useSessionDefaultsStore.getState().setThinking(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      approvalMode: 'safe',
      thinking: true,
    });
  });
});
