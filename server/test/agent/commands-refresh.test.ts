import { describe, expect, it, mock } from 'bun:test';
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { CommandsAvailablePayload } from 'shared/types';
import type { ActiveSession, SessionManager } from '../../src/services/session-manager';

// Capture the broadcast emit path so we can assert the commands_available event.
type Broadcast = { type: string; payload: unknown };
const broadcasts: Broadcast[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload });
    return { type, payload };
  },
}));

const { refreshCatalog, getCatalog } = await import('../../src/services/agent/commands-catalog');

function fakeActive(workDir: string, supported: () => Promise<SlashCommand[]>): ActiveSession {
  return {
    sessionId: 'sess-x',
    workDir,
    query: { supportedCommands: supported },
  } as unknown as ActiveSession;
}

const fakeManager = {} as unknown as SessionManager;

describe('refreshCatalog', () => {
  it('builds the catalog, stores it for the workDir, and broadcasts commands_available', async () => {
    broadcasts.length = 0;
    const workDir = '/tmp/work-refresh-1';
    const active = fakeActive(workDir, async () => [
      { name: 'deploy', description: 'Ship it', argumentHint: '[env]' },
    ]);

    await refreshCatalog(active, ['deploy'], [], fakeManager);

    const expected = [
      { name: 'deploy', description: 'Ship it', argumentHint: '[env]', kind: 'project' as const },
    ];
    expect(getCatalog(workDir)).toEqual(expected);
    expect(active.commands).toEqual(expected);

    const ev = broadcasts.find((b) => b.type === 'commands_available');
    expect(ev).toBeDefined();
    expect((ev?.payload as CommandsAvailablePayload).commands).toEqual(expected);
  });

  it('falls back to names-only when supportedCommands() throws', async () => {
    broadcasts.length = 0;
    const workDir = '/tmp/work-refresh-2';
    const active = fakeActive(workDir, async () => {
      throw new Error('rpc failed');
    });

    await refreshCatalog(active, ['deploy'], ['pdf'], fakeManager);

    const expected = [
      { name: 'deploy', description: '', argumentHint: '', kind: 'project' as const },
      { name: 'pdf', description: '', argumentHint: '', kind: 'skill' as const },
    ];
    expect(getCatalog(workDir)).toEqual(expected);
    const ev = broadcasts.find((b) => b.type === 'commands_available');
    expect((ev?.payload as CommandsAvailablePayload).commands).toEqual(expected);
  });
});
