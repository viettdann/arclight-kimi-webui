import { describe, expect, it } from 'bun:test';
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { tryHandleSlashCommand } from '../../src/services/agent/commands';
import { buildCatalog } from '../../src/services/agent/commands-catalog';
import type { ActiveSession } from '../../src/services/session-manager';

// buildCatalog merges the SDK init lists (`slash_commands` + `skills`) with the
// rich metadata from `supportedCommands()`, tagging skill vs project and
// excluding built-ins (compact/init) and blacklisted native commands.

function rich(...cmds: SlashCommand[]): SlashCommand[] {
  return cmds;
}

describe('buildCatalog', () => {
  it('tags skills vs project commands and pulls rich metadata', () => {
    const out = buildCatalog(
      ['deploy', 'lint'],
      ['pdf'],
      rich(
        { name: 'deploy', description: 'Ship it', argumentHint: '[env]' },
        { name: 'pdf', description: 'Read a PDF', argumentHint: '<file>', aliases: ['p'] },
      ),
    );
    expect(out).toEqual([
      { name: 'deploy', description: 'Ship it', argumentHint: '[env]', kind: 'project' },
      { name: 'lint', description: '', argumentHint: '', kind: 'project' },
      {
        name: 'pdf',
        description: 'Read a PDF',
        argumentHint: '<file>',
        aliases: ['p'],
        kind: 'skill',
      },
    ]);
  });

  it('excludes blacklisted native commands and static built-ins', () => {
    const out = buildCatalog(['clear', 'compact', 'init', 'deploy'], [], []);
    // clear is blacklisted; compact/init are static passthrough built-ins.
    expect(out.map((c) => c.name)).toEqual(['deploy']);
  });

  it('falls back to empty description/argumentHint when rich lacks the name', () => {
    const out = buildCatalog(['deploy'], [], []);
    expect(out).toEqual([{ name: 'deploy', description: '', argumentHint: '', kind: 'project' }]);
  });

  it('dedupes a name in both lists once; kind follows the skill set', () => {
    // A name present in both `slash_commands` and `skills` appears once (order
    // preserved from the commands list), and `kind` is decided by skill membership.
    const out = buildCatalog(['shared'], ['shared'], []);
    expect(out).toEqual([{ name: 'shared', description: '', argumentHint: '', kind: 'skill' }]);
  });
});

function stubActive(commands?: ActiveSession['commands']): ActiveSession {
  return { commands } as unknown as ActiveSession;
}

describe('tryHandleSlashCommand', () => {
  it('returns true for a blacklisted command (swallow)', () => {
    expect(tryHandleSlashCommand(stubActive(), '/clear')).toBe(true);
  });

  it('returns true for an unknown command once the dynamic catalog is known', () => {
    const active = stubActive([
      { name: 'deploy', description: '', argumentHint: '', kind: 'project' },
    ]);
    expect(tryHandleSlashCommand(active, '/frobnicate')).toBe(true);
  });

  it('returns false for a passthrough built-in (/compact)', () => {
    expect(tryHandleSlashCommand(stubActive(), '/compact summarize')).toBe(false);
  });

  it('returns false for a dynamic-catalog member', () => {
    const active = stubActive([
      { name: 'deploy', description: '', argumentHint: '', kind: 'project' },
    ]);
    expect(tryHandleSlashCommand(active, '/deploy prod')).toBe(false);
  });

  it('returns false for plain (non-slash) text', () => {
    expect(tryHandleSlashCommand(stubActive(), 'hello world')).toBe(false);
  });
});
