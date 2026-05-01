import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import { type CreateKimiArgs, restoreFromBackup } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, stubSession } from '../_helpers';

// End-to-end plumbing for `yoloMode`:
//   1. handleCreateSession forwards `payload.yoloMode` into createKimi(...).
//   2. handleCreateSession persists yoloMode in the sessions row.
//   3. restoreFromBackup forwards `sessRow.yoloMode` into the createKimi factory.
//
// We don't stand up the SDK; instead we inject a stub factory that records the
// args it was called with. The DB is the recording fake from `_helpers`.

let manager: KimiSessionManager;

beforeEach(() => {
  manager = new KimiSessionManager();
});

afterEach(() => {
  setHandlerDeps(null);
});

describe('handleCreateSession — yoloMode plumbing', () => {
  it('forwards yoloMode=true into createKimi factory and persists it in the DB insert', async () => {
    const fake = makeFakeDb();
    const createKimiCalls: CreateKimiArgs[] = [];
    const fakeCreateKimi = (args: CreateKimiArgs): Session => {
      createKimiCalls.push(args);
      return stubSession({ sessionId: 'kimi-fake-1', workDir: args.workDir });
    };
    setHandlerDeps({
      manager,
      db: fake.db,
      createKimi:
        fakeCreateKimi as unknown as typeof import('../../src/services/kimi-session').createKimi,
    });

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'create_session',
        payload: {
          workDir: '/tmp/kimi-webui-test/alice/proj',
          yoloMode: true,
        },
      }),
    );

    expect(createKimiCalls.length).toBe(1);
    expect(createKimiCalls[0]?.yoloMode).toBe(true);
    expect(createKimiCalls[0]?.workDir).toBe('/tmp/kimi-webui-test/alice/proj');

    const insertCall = fake.calls.find(
      (c) => c.op === 'insert' && (c.values as { yoloMode?: boolean }).yoloMode === true,
    );
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as { workDir: string }).workDir).toBe(
      '/tmp/kimi-webui-test/alice/proj',
    );
  });

  it('defaults yoloMode to false in DB insert and omits it from createKimi args when payload omits it', async () => {
    const fake = makeFakeDb();
    const createKimiCalls: CreateKimiArgs[] = [];
    const fakeCreateKimi = (args: CreateKimiArgs): Session => {
      createKimiCalls.push(args);
      return stubSession({ sessionId: 'kimi-fake-2', workDir: args.workDir });
    };
    setHandlerDeps({
      manager,
      db: fake.db,
      createKimi:
        fakeCreateKimi as unknown as typeof import('../../src/services/kimi-session').createKimi,
    });

    const ws = new FakeWS('alice');
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'create_session',
        payload: {
          workDir: '/tmp/kimi-webui-test/alice/proj',
        },
      }),
    );

    expect(createKimiCalls.length).toBe(1);
    // Handler spreads `...(payload.yoloMode != null ? {yoloMode} : {})` —
    // when payload omits yoloMode, the key is absent from the args object.
    expect(createKimiCalls[0]?.yoloMode).toBeUndefined();

    const insertCall = fake.calls.find(
      (c) => c.op === 'insert' && (c.values as { workDir?: string }).workDir != null,
    );
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as { yoloMode: boolean }).yoloMode).toBe(false);
  });
});

describe('restoreFromBackup — yoloMode plumbing', () => {
  it('forwards sessRow.yoloMode=true into the createKimi factory', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        id: 'sess-1',
        userId: 'alice',
        workDir: '/tmp/work',
        model: null,
        thinking: false,
        yoloMode: true,
        status: 'active',
        kimiSessionId: 'kimi-x',
        title: null,
        totalTokens: 0,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      },
    ]);
    fake.selectQueue.push([]); // no session_files backup

    const factoryCalls: CreateKimiArgs[] = [];
    const createKimiFn = (args: CreateKimiArgs): Session => {
      factoryCalls.push(args);
      return stubSession({ sessionId: 'kimi-x', workDir: args.workDir });
    };

    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      createKimiFn,
    });

    expect(factoryCalls.length).toBe(1);
    expect(factoryCalls[0]?.yoloMode).toBe(true);
    expect(factoryCalls[0]?.sessionId).toBe('kimi-x');
  });

  it('forwards sessRow.yoloMode=false into the createKimi factory', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        id: 'sess-2',
        userId: 'alice',
        workDir: '/tmp/work',
        model: null,
        thinking: false,
        yoloMode: false,
        status: 'active',
        kimiSessionId: 'kimi-y',
        title: null,
        totalTokens: 0,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      },
    ]);
    fake.selectQueue.push([]); // no session_files backup

    const factoryCalls: CreateKimiArgs[] = [];
    const createKimiFn = (args: CreateKimiArgs): Session => {
      factoryCalls.push(args);
      return stubSession({ sessionId: 'kimi-y', workDir: args.workDir });
    };

    await restoreFromBackup({
      sessionId: 'sess-2',
      manager,
      db: fake.db,
      createKimiFn,
    });

    expect(factoryCalls.length).toBe(1);
    expect(factoryCalls[0]?.yoloMode).toBe(false);
    expect(factoryCalls[0]?.sessionId).toBe('kimi-y');
  });
});
