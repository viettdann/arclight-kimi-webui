import { describe, expect, it } from 'bun:test';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import { teardownActiveSession } from '../../src/services/session-lifecycle';
import { KimiSessionManager } from '../../src/services/session-manager';
import { makeFakeDb, stubSession } from '../_helpers';

describe('Integration — teardownActiveSession', () => {
  it('closes the SDK and unregisters the session from memory', async () => {
    const fake = makeFakeDb();
    const manager = new KimiSessionManager();

    let closed = false;
    const kimiSession = {
      ...(stubSession({ sessionId: 'kimi-x', workDir: '/tmp/work' }) as object),
      close: async () => {
        closed = true;
      },
    } as unknown as Session;

    const active = manager.register({
      sessionId: 'sess-close-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession,
    });

    expect(manager.peek('sess-close-1')).not.toBeNull();

    await teardownActiveSession(active, { manager, db: fake.db });

    // SDK was closed and the in-memory slot freed.
    expect(closed).toBe(true);
    expect(manager.peek('sess-close-1')).toBeNull();
  });

  it('is idempotent across concurrent callers (SDK closed once)', async () => {
    const fake = makeFakeDb();
    const manager = new KimiSessionManager();

    let closeCount = 0;
    const kimiSession = {
      ...(stubSession({ sessionId: 'kimi-y', workDir: '/tmp/work' }) as object),
      close: async () => {
        closeCount += 1;
      },
    } as unknown as Session;

    const active = manager.register({
      sessionId: 'sess-close-2',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-y',
      kimiSession,
    });

    await Promise.all([
      teardownActiveSession(active, { manager, db: fake.db }),
      teardownActiveSession(active, { manager, db: fake.db }),
    ]);

    expect(closeCount).toBe(1);
    expect(manager.peek('sess-close-2')).toBeNull();
  });
});
