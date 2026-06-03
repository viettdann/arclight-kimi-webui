import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGit } from '../../../src/services/git/run';

describe('runGit', () => {
  it('captures stdout and reports exitCode 0 on success', async () => {
    const r = await runGit(['--version'], { timeoutMs: 5_000, captureStdout: true });
    expect(r.spawnFailed).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('git version');
    expect(r.stderr).toBe('');
  });

  it('leaves stdout empty when captureStdout is false (still exits 0)', async () => {
    const r = await runGit(['--version'], { timeoutMs: 5_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.spawnFailed).toBe(false);
  });

  it('returns a non-zero exitCode + stderr for a failing sub-command', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kimi-rungit-'));
    try {
      // rev-parse outside any repo fails with a non-zero exit and a fatal: line.
      const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: dir,
        timeoutMs: 5_000,
        captureStdout: true,
      });
      expect(r.spawnFailed).toBe(false);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs in the provided cwd', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kimi-rungit-cwd-'));
    try {
      const init = await runGit(['init', '-q'], { cwd: dir, timeoutMs: 5_000 });
      expect(init.exitCode).toBe(0);

      const r = await runGit(['rev-parse', '--is-inside-work-tree'], {
        cwd: dir,
        timeoutMs: 5_000,
        captureStdout: true,
      });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('true');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
