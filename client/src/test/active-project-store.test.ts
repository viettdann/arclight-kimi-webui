import { renderHook } from '@testing-library/react';
import type { SessionListItem } from 'shared/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useActiveProjectName, useActiveProjectStore } from '@/lib/active-project-store';
import { useSessionsStore } from '@/lib/sessions-store';

const sess = (id: string, projectName: string): SessionListItem =>
  ({ id, projectName }) as SessionListItem;

describe('useActiveProjectStore', () => {
  beforeEach(() => {
    useActiveProjectStore.setState({ selectedProjectName: null });
  });

  it('starts with no selection', () => {
    expect(useActiveProjectStore.getState().selectedProjectName).toBeNull();
  });

  it('select sets the project name', () => {
    useActiveProjectStore.getState().select('proj-a');
    expect(useActiveProjectStore.getState().selectedProjectName).toBe('proj-a');
  });

  it('select(null) clears the selection', () => {
    useActiveProjectStore.getState().select('proj-a');
    useActiveProjectStore.getState().select(null);
    expect(useActiveProjectStore.getState().selectedProjectName).toBeNull();
  });
});

describe('useActiveProjectName', () => {
  beforeEach(() => {
    useActiveProjectStore.setState({ selectedProjectName: null });
    useSessionsStore.setState({ sessions: [], status: 'idle', error: null });
  });
  afterEach(() => {
    useSessionsStore.setState({ sessions: [], status: 'idle', error: null });
  });

  it('returns the open session’s project when a sessionId is given', () => {
    useSessionsStore.setState({ sessions: [sess('s1', 'session-proj')] });
    useActiveProjectStore.setState({ selectedProjectName: 'selected-proj' });

    const { result } = renderHook(() => useActiveProjectName('s1'));
    expect(result.current).toBe('session-proj');
  });

  it('falls back to the selected project when there is no session', () => {
    useActiveProjectStore.setState({ selectedProjectName: 'selected-proj' });

    const { result } = renderHook(() => useActiveProjectName(undefined));
    expect(result.current).toBe('selected-proj');
  });

  it('returns null when neither a session nor a selection exists', () => {
    const { result } = renderHook(() => useActiveProjectName(undefined));
    expect(result.current).toBeNull();
  });

  it('returns null when the sessionId matches no known session', () => {
    useSessionsStore.setState({ sessions: [sess('s1', 'session-proj')] });
    useActiveProjectStore.setState({ selectedProjectName: 'selected-proj' });

    // A session route whose session isn't in the list yet resolves to null
    // (session wins over selection even before the list loads).
    const { result } = renderHook(() => useActiveProjectName('unknown'));
    expect(result.current).toBeNull();
  });
});
