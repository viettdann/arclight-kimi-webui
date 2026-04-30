import { describe, expect, it } from 'bun:test';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import { type ActiveSession, KimiSessionManager } from '../src/services/session-manager';

// `getOrRestore` invariant #3: concurrent subscribers for the same not-in-
// memory session share a single restore Promise. Verify exactly one restoreFn
// call regardless of how many parallel callers fire.

const stubKimi = {} as unknown as Session;

function fakeRestore(
  manager: KimiSessionManager,
  ownerUserId: string,
  delayMs = 5,
): {
  fn: (sessionId: string) => Promise<ActiveSession>;
  callCount: () => number;
} {
  let count = 0;
  const fn = async (sessionId: string): Promise<ActiveSession> => {
    count += 1;
    await new Promise((res) => setTimeout(res, delayMs));
    return manager.register({
      sessionId,
      userId: ownerUserId,
      workDir: '/tmp/work',
      kimiSessionId: `kimi-${sessionId}`,
      kimiSession: stubKimi,
    });
  };
  return { fn, callCount: () => count };
}

describe('getOrRestore — in-flight cache', () => {
  it('two concurrent restores for the same session → exactly one restoreFn call', async () => {
    const manager = new KimiSessionManager();
    const restore = fakeRestore(manager, 'alice');

    const [a, b] = await Promise.all([
      manager.getOrRestore('alice', 'sess-A', restore.fn),
      manager.getOrRestore('alice', 'sess-A', restore.fn),
    ]);

    expect(restore.callCount()).toBe(1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBe(b);
    expect(manager.size).toBe(1);
  });

  it('three concurrent restores collapse to one call', async () => {
    const manager = new KimiSessionManager();
    const restore = fakeRestore(manager, 'alice', 10);

    const results = await Promise.all([
      manager.getOrRestore('alice', 'sess-A', restore.fn),
      manager.getOrRestore('alice', 'sess-A', restore.fn),
      manager.getOrRestore('alice', 'sess-A', restore.fn),
    ]);

    expect(restore.callCount()).toBe(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).not.toBeNull();
  });

  it('concurrent restores for different sessions do NOT collapse', async () => {
    const manager = new KimiSessionManager();
    const restore = fakeRestore(manager, 'alice');

    await Promise.all([
      manager.getOrRestore('alice', 'sess-A', restore.fn),
      manager.getOrRestore('alice', 'sess-B', restore.fn),
    ]);

    expect(restore.callCount()).toBe(2);
    expect(manager.size).toBe(2);
  });

  it('serial restore after first resolves: restore is no-op (already in memory)', async () => {
    const manager = new KimiSessionManager();
    const restore = fakeRestore(manager, 'alice');

    await manager.getOrRestore('alice', 'sess-A', restore.fn);
    await manager.getOrRestore('alice', 'sess-A', restore.fn);

    expect(restore.callCount()).toBe(1);
  });

  it('cross-user lookup against restored session → null, restoreFn still ran once', async () => {
    const manager = new KimiSessionManager();
    const restore = fakeRestore(manager, 'alice');

    const [aliceResult, bobResult] = await Promise.all([
      manager.getOrRestore('alice', 'sess-A', restore.fn),
      manager.getOrRestore('bob', 'sess-A', restore.fn),
    ]);

    expect(restore.callCount()).toBe(1);
    expect(aliceResult).not.toBeNull();
    expect(bobResult).toBeNull();
  });

  it('restoreFn throw → both concurrent callers receive null, retry triggers fresh restore', async () => {
    const manager = new KimiSessionManager();
    let calls = 0;
    let throwOnce = true;
    const fn = async (sessionId: string): Promise<ActiveSession> => {
      calls += 1;
      await new Promise((res) => setTimeout(res, 5));
      if (throwOnce) {
        throwOnce = false;
        throw new Error('not_found');
      }
      return manager.register({
        sessionId,
        userId: 'alice',
        workDir: '/tmp/work',
        kimiSessionId: `kimi-${sessionId}`,
        kimiSession: stubKimi,
      });
    };

    const [a, b] = await Promise.all([
      manager.getOrRestore('alice', 'sess-A', fn),
      manager.getOrRestore('alice', 'sess-A', fn),
    ]);
    expect(calls).toBe(1); // first attempt shared
    expect(a).toBeNull();
    expect(b).toBeNull();

    // Second-attempt retry: cache cleared on rejection, fresh call allowed.
    const c = await manager.getOrRestore('alice', 'sess-A', fn);
    expect(calls).toBe(2);
    expect(c).not.toBeNull();
  });
});
