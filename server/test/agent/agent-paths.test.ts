import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { env } from '../../src/env';
import {
  AGENT_STATE_ROOT,
  agentConfigDirFor,
  agentHomeFor,
  ephemeralPaths,
  isUnderWorkspace,
  userMemoryPath,
  userSlugFromCwd,
} from '../../src/services/agent/agent-paths';

// Derive expectations from the (test-stubbed) env rather than hardcoding host
// paths. setup.ts sets WORKSPACE_ROOT=/tmp/mtc-webui-test and leaves
// CLAUDE_CONFIG_DIR unset, so AGENT_STATE_ROOT resolves to `${DATA_DIR}/agent-state`.
const WS = env.WORKSPACE_ROOT;

describe('AGENT_STATE_ROOT', () => {
  it('equals the resolved CLAUDE_CONFIG_DIR root', () => {
    expect(AGENT_STATE_ROOT).toBe(env.CLAUDE_CONFIG_DIR);
  });
});

describe('userSlugFromCwd', () => {
  it('returns the first segment under the workspace root', () => {
    expect(userSlugFromCwd(join(WS, 'dan.le', 'my-project'))).toBe('dan.le');
  });

  it('returns the slug when cwd IS the user root (no project segment)', () => {
    expect(userSlugFromCwd(join(WS, 'dan.le'))).toBe('dan.le');
  });

  it('handles a deep project path, taking only the first segment', () => {
    expect(userSlugFromCwd(join(WS, 'chau', 'repo', 'nested'))).toBe('chau');
  });

  it('preserves a slug containing already-slugified characters', () => {
    expect(userSlugFromCwd(join(WS, 'a_b-c.d', 'proj'))).toBe('a_b-c.d');
  });

  it('throws when cwd is outside the workspace root', () => {
    expect(() => userSlugFromCwd('/etc/passwd')).toThrow();
  });

  it('throws when cwd equals the workspace root (no user segment)', () => {
    expect(() => userSlugFromCwd(WS)).toThrow();
  });

  it('honors an explicit workspaceRoot argument', () => {
    expect(userSlugFromCwd('/custom/root/bob/proj', '/custom/root')).toBe('bob');
  });
});

describe('isUnderWorkspace', () => {
  it('is true for a project cwd under the workspace root', () => {
    expect(isUnderWorkspace(join(WS, 'dan.le', 'proj'))).toBe(true);
  });

  it('is true for the user root itself', () => {
    expect(isUnderWorkspace(join(WS, 'dan.le'))).toBe(true);
  });

  it('is false for a foreign/remote workDir outside the workspace', () => {
    expect(isUnderWorkspace('/remote/machine/proj')).toBe(false);
    expect(isUnderWorkspace('/tmp/work')).toBe(false);
  });

  it('is false for the workspace root itself (no user segment)', () => {
    expect(isUnderWorkspace(WS)).toBe(false);
  });

  it('honors an explicit workspaceRoot argument', () => {
    expect(isUnderWorkspace('/custom/root/bob/p', '/custom/root')).toBe(true);
    expect(isUnderWorkspace('/elsewhere/p', '/custom/root')).toBe(false);
  });

  it('never throws (unlike userSlugFromCwd) for an out-of-workspace cwd', () => {
    expect(() => isUnderWorkspace('/etc/passwd')).not.toThrow();
  });
});

describe('agentHomeFor', () => {
  it('is WORKSPACE_ROOT/<userSlug>', () => {
    expect(agentHomeFor(join(WS, 'dan.le', 'my-project'))).toBe(join(WS, 'dan.le'));
  });

  it('does not include the project segment', () => {
    expect(agentHomeFor(join(WS, 'chau', 'deep', 'nested'))).toBe(join(WS, 'chau'));
  });
});

describe('agentConfigDirFor', () => {
  it('is AGENT_STATE_ROOT/<userSlug>', () => {
    expect(agentConfigDirFor(join(WS, 'dan.le', 'my-project'))).toBe(
      join(AGENT_STATE_ROOT, 'dan.le'),
    );
  });

  it('separates two users into distinct config dirs', () => {
    const a = agentConfigDirFor(join(WS, 'dan.le', 'p1'));
    const b = agentConfigDirFor(join(WS, 'chau', 'p2'));
    expect(a).toBe(join(AGENT_STATE_ROOT, 'dan.le'));
    expect(b).toBe(join(AGENT_STATE_ROOT, 'chau'));
    expect(a).not.toBe(b);
  });
});

describe('ephemeralPaths', () => {
  it('returns a shared throwaway dir under AGENT_STATE_ROOT for home and config', () => {
    const p = ephemeralPaths();
    expect(p.configDir).toBe(join(AGENT_STATE_ROOT, '_ephemeral'));
    expect(p.home).toBe(p.configDir);
  });

  it('never collides with a real user config dir', () => {
    expect(ephemeralPaths().configDir).not.toBe(agentConfigDirFor(join(WS, 'dan.le', 'p')));
  });
});

describe('userMemoryPath', () => {
  it('is WORKSPACE_ROOT/<userSlug>/.claude/CLAUDE.md', () => {
    expect(userMemoryPath('dan.le')).toBe(join(WS, 'dan.le', '.claude', 'CLAUDE.md'));
  });

  it('separates two users into distinct memory files', () => {
    expect(userMemoryPath('dan.le')).not.toBe(userMemoryPath('chau'));
  });
});
