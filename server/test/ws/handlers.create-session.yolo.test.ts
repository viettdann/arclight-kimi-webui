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
    // yoloMode=true derives approvalMode='yolo'.
    expect((insertCall?.values as { approvalMode: string }).approvalMode).toBe('yolo');
  });

  it('payload.approvalMode=auto persists mode but forwards yoloMode=false to the SDK', async () => {
    const fake = makeFakeDb();
    const createKimiCalls: CreateKimiArgs[] = [];
    const fakeCreateKimi = (args: CreateKimiArgs): Session => {
      createKimiCalls.push(args);
      return stubSession({ sessionId: 'kimi-fake-auto', workDir: args.workDir });
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
          approvalMode: 'auto',
        },
      }),
    );

    expect(createKimiCalls.length).toBe(1);
    // auto tier runs the SDK with yolo OFF; the server gates safe tools.
    expect(createKimiCalls[0]?.yoloMode).toBe(false);

    const insertCall = fake.calls.find(
      (c) => c.op === 'insert' && (c.values as { workDir?: string }).workDir != null,
    );
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as { approvalMode: string }).approvalMode).toBe('auto');
    expect((insertCall?.values as { yoloMode: boolean }).yoloMode).toBe(false);
  });

  it('rejects bad_request for an invalid approvalMode enum', async () => {
    const fake = makeFakeDb();
    const createKimiCalls: CreateKimiArgs[] = [];
    const fakeCreateKimi = (args: CreateKimiArgs): Session => {
      createKimiCalls.push(args);
      return stubSession({ sessionId: 'kimi-fake-bad', workDir: args.workDir });
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
          approvalMode: 'bogus',
        },
      }),
    );

    expect(createKimiCalls.length).toBe(0);
    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    const errors = ws.parsed().filter((m) => m.type === 'error') as Array<{
      payload: { code: string };
    }>;
    expect(errors[0]?.payload.code).toBe('bad_request');
  });

  it('rejects bad_request when first segment of workDir is not slug-canonical', async () => {
    const fake = makeFakeDb();
    const createKimiCalls: CreateKimiArgs[] = [];
    const fakeCreateKimi = (args: CreateKimiArgs): Session => {
      createKimiCalls.push(args);
      return stubSession({ sessionId: 'kimi-fake-reject', workDir: args.workDir });
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
          // Capital letters and space → slugifyProjectName('Foo Bar') = 'foo-bar' ≠ 'Foo Bar'.
          workDir: '/tmp/kimi-webui-test/alice/Foo Bar',
        },
      }),
    );

    // No factory call, no DB insert.
    expect(createKimiCalls.length).toBe(0);
    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeUndefined();

    // Error frame emitted.
    const errors = ws.parsed().filter((m) => m.type === 'error') as Array<{
      payload: { code: string };
    }>;
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.payload.code).toBe('bad_request');
  });

  it('defaults yoloMode to false in both createKimi args and DB insert when payload omits it', async () => {
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
    // Handler resolves yoloMode (payload ?? config default ?? false) and always
    // forwards it. With no payload and a fake DB (loadOrSeed throws → caught),
    // the resolved value is false.
    expect(createKimiCalls[0]?.yoloMode).toBe(false);

    const insertCall = fake.calls.find(
      (c) => c.op === 'insert' && (c.values as { workDir?: string }).workDir != null,
    );
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as { yoloMode: boolean }).yoloMode).toBe(false);
    // No yolo and no explicit mode → approvalMode='ask'.
    expect((insertCall?.values as { approvalMode: string }).approvalMode).toBe('ask');
  });
});

describe('restoreFromBackup — yoloMode plumbing', () => {
  it('forwards sessRow.yoloMode=true into the createKimi factory', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        session: {
          id: 'sess-1',
          userId: 'alice',
          workDir: '/tmp/kimi-webui-test/alice/proj',
          projectName: 'proj',
          model: null,
          thinking: false,
          yoloMode: true,
          approvalMode: 'yolo',
          status: 'active',
          kimiSessionId: 'kimi-x',
          title: null,
          totalTokens: 0,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        },
        userEmail: 'alice@example.com',
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
      env: { WORKSPACE_ROOT: '/tmp/kimi-webui-test' },
      createKimiFn,
    });

    expect(factoryCalls.length).toBe(1);
    expect(factoryCalls[0]?.yoloMode).toBe(true);
    expect(factoryCalls[0]?.sessionId).toBe('kimi-x');
    // approvalMode from the row is carried onto the ActiveSession.
    expect(manager.peek('sess-1')?.approvalMode).toBe('yolo');
  });

  it('forwards sessRow.yoloMode=false into the createKimi factory', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        session: {
          id: 'sess-2',
          userId: 'alice',
          workDir: '/tmp/kimi-webui-test/alice/proj',
          projectName: 'proj',
          model: null,
          thinking: false,
          yoloMode: false,
          approvalMode: 'ask',
          status: 'active',
          kimiSessionId: 'kimi-y',
          title: null,
          totalTokens: 0,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        },
        userEmail: 'alice@example.com',
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
      env: { WORKSPACE_ROOT: '/tmp/kimi-webui-test' },
      createKimiFn,
    });

    expect(factoryCalls.length).toBe(1);
    expect(factoryCalls[0]?.yoloMode).toBe(false);
    expect(factoryCalls[0]?.sessionId).toBe('kimi-y');
    expect(manager.peek('sess-2')?.approvalMode).toBe('ask');
  });
});
