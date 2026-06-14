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

const { refreshCatalog, applySkillsToCatalog, getCatalog, setCatalog } = await import(
  '../../src/services/agent/commands-catalog'
);

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

function catalogActive(workDir: string, commands?: ActiveSession['commands']): ActiveSession {
  return { sessionId: 'sess-skill', workDir, commands } as unknown as ActiveSession;
}

describe('applySkillsToCatalog', () => {
  it('keeps project commands, overlays enabled skills, and broadcasts', () => {
    broadcasts.length = 0;
    const workDir = '/tmp/work-skill-1';
    const active = catalogActive(workDir, [
      { name: 'deploy', description: 'Ship it', argumentHint: '[env]', kind: 'project' },
    ]);

    applySkillsToCatalog(active, [{ name: 'pdf', description: 'Read a PDF' }], fakeManager);

    const expected = [
      { name: 'deploy', description: 'Ship it', argumentHint: '[env]', kind: 'project' as const },
      { name: 'pdf', description: 'Read a PDF', argumentHint: '', kind: 'skill' as const },
    ];
    expect(getCatalog(workDir)).toEqual(expected);
    expect(active.commands).toEqual(expected);
    const ev = broadcasts.find((b) => b.type === 'commands_available');
    expect((ev?.payload as CommandsAvailablePayload).commands).toEqual(expected);
  });

  it('drops stale skill entries not in the new enabled set', () => {
    const workDir = '/tmp/work-skill-2';
    const active = catalogActive(workDir, [
      { name: 'deploy', description: '', argumentHint: '', kind: 'project' },
      { name: 'old-skill', description: '', argumentHint: '', kind: 'skill' },
    ]);

    applySkillsToCatalog(active, [{ name: 'new-skill', description: 'fresh' }], fakeManager);

    expect(active.commands?.map((c) => c.name)).toEqual(['deploy', 'new-skill']);
  });

  it('excludes blacklisted/built-in names and dedupes against project commands', () => {
    const workDir = '/tmp/work-skill-3';
    const active = catalogActive(workDir, [
      { name: 'deploy', description: '', argumentHint: '', kind: 'project' },
    ]);

    applySkillsToCatalog(
      active,
      [
        { name: 'review', description: 'blacklisted' }, // blacklisted native
        { name: 'compact', description: 'built-in' }, // static passthrough
        { name: 'deploy', description: 'collides' }, // already a project command
        { name: 'real', description: 'ok' },
      ],
      fakeManager,
    );

    expect(active.commands?.map((c) => c.name)).toEqual(['deploy', 'real']);
  });

  it('reads the cached catalog when active.commands is unset', () => {
    const workDir = '/tmp/work-skill-4';
    setCatalog(workDir, [{ name: 'deploy', description: '', argumentHint: '', kind: 'project' }]);
    const active = catalogActive(workDir, undefined);

    applySkillsToCatalog(active, [{ name: 'pdf', description: '' }], fakeManager);

    expect(active.commands?.map((c) => c.name)).toEqual(['deploy', 'pdf']);
  });
});
