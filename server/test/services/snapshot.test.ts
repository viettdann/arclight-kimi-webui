import { afterAll, describe, expect, it, mock } from 'bun:test';
import * as realFsPromises from 'node:fs/promises';
import type { Block } from 'shared/types';
import { KimiSessionManager } from '../../src/services/session-manager';
import { buildSnapshot } from '../../src/services/snapshot';
import { makeFakeDb, stubSession } from '../_helpers';

type BlockOfKind<K extends Block['kind']> = Extract<Block, { kind: K }>;
function assertKind<K extends Block['kind']>(b: Block | undefined, kind: K): BlockOfKind<K> {
  if (!b || b.kind !== kind) throw new Error(`expected ${kind}, got ${b?.kind ?? 'undefined'}`);
  return b as BlockOfKind<K>;
}

// Snapshot real export before `mock.module` swaps the namespace.
const originalReadFile = realFsPromises.readFile;

mock.module('node:fs/promises', () => {
  return {
    ...realFsPromises,
    readFile: async (p: string, encoding?: any) => {
      if (p.endsWith('wire.jsonl')) {
        return `${JSON.stringify({
          timestamp: new Date().toISOString(),
          message: {
            type: 'TurnBegin',
            payload: {
              id: 'turn-1',
              user_slug: 'alice',
              user_input: [{ type: 'text', text: 'hi' }],
            },
          },
        })}\n`;
      }
      return originalReadFile(p, encoding);
    },
  };
});

afterAll(() => {
  mock.restore();
});

describe('buildSnapshot', () => {
  it('builds a correct SnapshotPayload when session is active', async () => {
    const fake = makeFakeDb();

    // 1. Session row
    fake.selectQueue.push([
      {
        id: 'sess-1',
        userId: 'alice',
        workDir: '/tmp/work',
        model: null,
        thinking: false,
        yoloMode: false,
        approvalMode: 'auto',
        status: 'active',
        kimiSessionId: 'kimi-x',
        title: 'Mock Session Title',
        totalTokens: 50,
      },
    ]);

    // 2. Pending prompt (none)
    fake.selectQueue.push([]);

    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    active.liveTextDelta = 'Streaming live text';
    active.liveTurnIdx = 0;
    active.liveStepIdx = 0;

    const snapshot = await buildSnapshot({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.title).toBe('Mock Session Title');
    expect(snapshot?.totalTokens).toBe(50);
    expect(snapshot?.status).toBe('active');
    expect(snapshot?.approvalMode).toBe('auto');
    // No `currentTurn` was attached to the active session in this test, so
    // resume should report no in-flight turn.
    expect(snapshot?.live.turnInProgress).toBe(false);

    // Should fold the TurnBegin from wire.jsonl + the live text delta overlay!
    expect(snapshot?.blocks.length).toBe(2);
    const userBlock = assertKind(snapshot?.blocks[0], 'user');
    expect(userBlock.content).toBe('hi');
    const textBlock = assertKind(snapshot?.blocks[1], 'text');
    expect(textBlock.content).toBe('Streaming live text');
    expect(textBlock.isStreaming).toBe(true);
  });

  it('reports live.turnInProgress=true when active session holds an in-flight Turn', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        id: 'sess-live',
        userId: 'alice',
        workDir: '/tmp/work',
        model: null,
        thinking: false,
        yoloMode: false,
        approvalMode: 'ask',
        status: 'active',
        kimiSessionId: 'kimi-x',
        title: null,
        totalTokens: 0,
      },
    ]);
    fake.selectQueue.push([]);

    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-live',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });
    // Pretend a Turn is in flight. buildSnapshot only checks for non-null,
    // not the shape, so a minimal stub is enough.
    active.currentTurn = {} as unknown as typeof active.currentTurn;

    const snapshot = await buildSnapshot({ sessionId: 'sess-live', manager, db: fake.db });
    expect(snapshot?.live.turnInProgress).toBe(true);
  });

  it('includes enqueued pending prompts at the tail of the block array', async () => {
    const fake = makeFakeDb();

    // 1. Session row
    fake.selectQueue.push([
      {
        id: 'sess-2',
        userId: 'alice',
        workDir: '/tmp/work',
        model: null,
        thinking: false,
        yoloMode: false,
        approvalMode: 'ask',
        status: 'active',
        kimiSessionId: 'kimi-x',
        title: 'Mock Session Title',
        totalTokens: 0,
      },
    ]);

    // 2. Pending prompt row (returned when peekPendingPrompt is called)
    const date = new Date();
    fake.selectQueue.push([
      {
        pendingPrompt: 'This prompt is pending',
        pendingEnqueuedAt: date,
      },
    ]);

    const manager = new KimiSessionManager();

    const snapshot = await buildSnapshot({
      sessionId: 'sess-2',
      manager,
      db: fake.db,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.pendingPrompt).toEqual({
      text: 'This prompt is pending',
      enqueuedAt: date.toISOString(),
    });

    const userPendingBlock = snapshot?.blocks.find(
      (b): b is BlockOfKind<'user'> => b.kind === 'user' && b.status === 'pending',
    );
    expect(userPendingBlock).toBeDefined();
    expect(userPendingBlock?.content).toBe('This prompt is pending');
  });
});
