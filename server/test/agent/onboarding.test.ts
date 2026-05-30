import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureClaudeOnboarding } from '../../src/services/agent/onboarding';

// Real filesystem against a throwaway temp dir — `ensureClaudeOnboarding`
// accepts an explicit configDir so it never touches the live CLAUDE_CONFIG_DIR.
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mtc-onboarding-'));
  file = join(dir, '.claude.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8'));
}

describe('ensureClaudeOnboarding', () => {
  it('creates .claude.json with hasCompletedOnboarding when absent', async () => {
    await ensureClaudeOnboarding(dir);
    expect(await readJson()).toEqual({ hasCompletedOnboarding: true });
  });

  it('merges into existing config, preserving other keys', async () => {
    await writeFile(file, JSON.stringify({ userID: 'abc', projects: { '/x': {} } }));
    await ensureClaudeOnboarding(dir);
    const cfg = await readJson();
    expect(cfg.hasCompletedOnboarding).toBe(true);
    expect(cfg.userID).toBe('abc');
    expect(cfg.projects).toEqual({ '/x': {} });
  });

  it('is a no-op when the flag is already true', async () => {
    await writeFile(file, JSON.stringify({ hasCompletedOnboarding: true, sentinel: 42 }));
    await ensureClaudeOnboarding(dir);
    const cfg = await readJson();
    expect(cfg.hasCompletedOnboarding).toBe(true);
    expect(cfg.sentinel).toBe(42);
  });

  it('overwrites an unparseable file with a minimal valid config', async () => {
    await writeFile(file, '{ this is not json');
    await ensureClaudeOnboarding(dir);
    expect(await readJson()).toEqual({ hasCompletedOnboarding: true });
  });
});
