import type { CommandInfo } from 'shared/commands';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCommandStore } from '@/lib/command-store';

const cmd = (name: string): CommandInfo => ({ name }) as CommandInfo;

describe('useCommandStore', () => {
  beforeEach(() => {
    useCommandStore.setState({ commandsBySession: {} });
  });

  it('setCommands stores a catalog under its sessionId', () => {
    useCommandStore.getState().setCommands('s1', [cmd('compact'), cmd('init')]);
    expect(useCommandStore.getState().commandsBySession.s1).toEqual([cmd('compact'), cmd('init')]);
  });

  it('setCommands overwrites a session catalog and leaves others intact', () => {
    useCommandStore.getState().setCommands('s1', [cmd('a')]);
    useCommandStore.getState().setCommands('s2', [cmd('b')]);
    useCommandStore.getState().setCommands('s1', [cmd('c')]);
    const map = useCommandStore.getState().commandsBySession;
    expect(map.s1).toEqual([cmd('c')]);
    expect(map.s2).toEqual([cmd('b')]);
  });

  it('removeSession drops a session catalog', () => {
    useCommandStore.getState().setCommands('s1', [cmd('a')]);
    useCommandStore.getState().setCommands('s2', [cmd('b')]);
    useCommandStore.getState().removeSession('s1');
    const map = useCommandStore.getState().commandsBySession;
    expect('s1' in map).toBe(false);
    expect(map.s2).toEqual([cmd('b')]);
  });

  it('removeSession is a no-op for an unknown session (same reference)', () => {
    useCommandStore.getState().setCommands('s1', [cmd('a')]);
    const before = useCommandStore.getState().commandsBySession;
    useCommandStore.getState().removeSession('missing');
    expect(useCommandStore.getState().commandsBySession).toBe(before);
  });
});
