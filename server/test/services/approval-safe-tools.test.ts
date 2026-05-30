import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_SAFE_TOOLS,
  isAutoApprovable,
  isShellCommandSafe,
} from '../../src/services/approval-safe-tools';

describe('isAutoApprovable — read-only tools', () => {
  it('approves every default read-only tool on name alone', () => {
    for (const tool of DEFAULT_SAFE_TOOLS) {
      expect(isAutoApprovable(tool)).toBe(true);
    }
  });

  it('asks for side-effecting tools', () => {
    expect(isAutoApprovable('write')).toBe(false);
    expect(isAutoApprovable('edit')).toBe(false);
  });

  it('asks (fail-safe) for an unknown tool name', () => {
    expect(isAutoApprovable('definitely_not_a_tool')).toBe(false);
  });

  it('honors a user allowlist for an otherwise-unknown tool', () => {
    expect(isAutoApprovable('custom_reader', { userAllowlist: ['custom_reader'] })).toBe(true);
    expect(isAutoApprovable('write', { userAllowlist: ['custom_reader'] })).toBe(false);
  });

  it('asks when a read-only tool targets a secret file (any arg key)', () => {
    expect(isAutoApprovable('read', { args: { path: '.env' } })).toBe(false);
    expect(isAutoApprovable('read', { args: { path: 'config/.env.local' } })).toBe(false);
    expect(isAutoApprovable('read', { args: { file: '.env.production' } })).toBe(false);
    expect(isAutoApprovable('read', { args: { target: 'deploy/.env.staging' } })).toBe(false);
    expect(isAutoApprovable('read', { args: { path: 'secrets/id_rsa' } })).toBe(false);
    expect(isAutoApprovable('read', { args: { path: 'certs/server.pem' } })).toBe(false);
  });

  it('approves a read-only tool on an ordinary file', () => {
    expect(isAutoApprovable('read', { args: { path: 'src/index.ts' } })).toBe(true);
    expect(isAutoApprovable('read', { args: { path: 'environment.md' } })).toBe(true);
  });
});

describe('isShellCommandSafe', () => {
  it('approves a single read-only binary invocation', () => {
    expect(isShellCommandSafe('ls -la')).toBe(true);
    expect(isShellCommandSafe('cat README.md')).toBe(true);
    expect(isShellCommandSafe('grep -rn foo src')).toBe(true);
    expect(isShellCommandSafe('pwd')).toBe(true);
  });

  it('approves find with quoted globs (the motivating case)', () => {
    expect(isShellCommandSafe('find apps/backend -name "*.sln" -o -name "*.slnx"')).toBe(true);
    expect(isShellCommandSafe("find . -name '*.ts'")).toBe(true);
  });

  it('approves harmless discard-redirects (stderr to /dev/null)', () => {
    expect(
      isShellCommandSafe('find . -name "package.json" -not -path "*/node_modules/*" 2>/dev/null'),
    ).toBe(true);
    expect(isShellCommandSafe('find . -name x >/dev/null 2>&1')).toBe(true);
    expect(isShellCommandSafe('grep foo bar.txt 2>/dev/null')).toBe(true);
  });

  it('still asks for a redirect that targets a real file', () => {
    expect(isShellCommandSafe('cat secret > out.txt')).toBe(false);
    expect(isShellCommandSafe('find . -name x > listing.txt')).toBe(false);
    expect(isShellCommandSafe('grep foo bar 2>err.log')).toBe(false);
  });

  it('asks for a non-read-only binary', () => {
    expect(isShellCommandSafe('rm -rf /')).toBe(false);
    expect(isShellCommandSafe('curl http://evil')).toBe(false);
    expect(isShellCommandSafe('git push')).toBe(false);
  });

  it('asks when command chains, pipes, or redirects (unquoted metachars)', () => {
    expect(isShellCommandSafe('ls; rm -rf /')).toBe(false);
    expect(isShellCommandSafe('cat a && rm b')).toBe(false);
    expect(isShellCommandSafe('find . | xargs rm')).toBe(false);
    expect(isShellCommandSafe('cat secret > /tmp/x')).toBe(false);
    expect(isShellCommandSafe('echo $(rm -rf /)')).toBe(false);
    expect(isShellCommandSafe('cat `whoami`')).toBe(false);
    expect(isShellCommandSafe('ls *')).toBe(false);
  });

  it('asks for an empty command or an unterminated quote', () => {
    expect(isShellCommandSafe('')).toBe(false);
    expect(isShellCommandSafe('   ')).toBe(false);
    expect(isShellCommandSafe('find . -name "*.ts')).toBe(false);
  });

  it('asks when the binary is given by path (bypass attempt)', () => {
    expect(isShellCommandSafe('/bin/ls')).toBe(false);
    expect(isShellCommandSafe('./ls')).toBe(false);
  });

  it('asks when a read-only shell command targets a secret file', () => {
    expect(isShellCommandSafe('cat .env')).toBe(false);
    expect(isShellCommandSafe('cat config/.env.production')).toBe(false);
    expect(isShellCommandSafe('grep SECRET .env.local')).toBe(false);
  });
});

describe('isAutoApprovable — shell tools', () => {
  it('approves a shell tool with a vetted read-only command', () => {
    expect(isAutoApprovable('Bash', { command: 'find apps -name "*.sln"' })).toBe(true);
    expect(isAutoApprovable('bash', { command: 'ls -la' })).toBe(true);
  });

  it('asks for a shell tool with a side-effecting command', () => {
    expect(isAutoApprovable('Bash', { command: 'rm -rf /' })).toBe(false);
  });

  it('asks for a shell tool with no command (fail-safe)', () => {
    expect(isAutoApprovable('Bash', {})).toBe(false);
  });

  it('falls back to the command when extracted from args', () => {
    expect(isAutoApprovable('Bash', { command: 'cat .env' })).toBe(false);
  });

  it('matches tool names case-insensitively (SDK reports "Bash", "Read")', () => {
    expect(isAutoApprovable('Bash', { command: 'find . -name x 2>/dev/null' })).toBe(true);
    expect(isAutoApprovable('Read', { args: { path: 'src/a.ts' } })).toBe(true);
    expect(isAutoApprovable('Read', { args: { path: '.env' } })).toBe(false);
  });
});
