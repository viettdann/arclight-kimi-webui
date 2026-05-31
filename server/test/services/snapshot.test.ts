import { describe, expect, it } from 'bun:test';
import { setCatalog } from '../../src/services/agent/commands-catalog';
import { SessionManager } from '../../src/services/session-manager';
import { buildSnapshot, emptySnapshot } from '../../src/services/snapshot';
import { makeFakeDb } from '../_helpers';

// buildSnapshot reflects the persisted effort column and the in-memory catalog
// for the session's workDir; emptySnapshot is the canonical zero state.

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    workDir: '/tmp/snap-work',
    totalTokens: 0,
    totalCostUsd: '0',
    title: null,
    pendingPrompt: null,
    pendingEnqueuedAt: null,
    thinking: false,
    approvalMode: 'ask',
    effort: null,
    ...overrides,
  };
}

describe('buildSnapshot — effort + commands', () => {
  it('carries the persisted effort and the workDir catalog', async () => {
    const workDir = '/tmp/snap-work-effort';
    const catalog = [
      { name: 'deploy', description: 'Ship it', argumentHint: '[env]', kind: 'project' as const },
    ];
    setCatalog(workDir, catalog);

    const fake = makeFakeDb();
    fake.selectQueue.push([sessionRow({ effort: 'high', workDir })]); // sessions row
    fake.selectQueue.push([]); // no transcript

    const snap = await buildSnapshot({
      sessionId: 'sess-1',
      db: fake.db,
      manager: new SessionManager(),
    });

    expect(snap).not.toBeNull();
    expect(snap?.effort).toBe('high');
    expect(snap?.commands).toEqual(catalog);
  });

  it('defaults effort to null and commands to [] when unset', async () => {
    const fake = makeFakeDb();
    // workDir has no catalog registered.
    fake.selectQueue.push([sessionRow({ workDir: '/tmp/snap-work-none' })]);
    fake.selectQueue.push([]);

    const snap = await buildSnapshot({
      sessionId: 'sess-1',
      db: fake.db,
      manager: new SessionManager(),
    });

    expect(snap?.effort).toBeNull();
    expect(snap?.commands).toEqual([]);
  });
});

describe('emptySnapshot', () => {
  it('has effort:null and commands:[]', () => {
    const snap = emptySnapshot();
    expect(snap.effort).toBeNull();
    expect(snap.commands).toEqual([]);
  });
});
