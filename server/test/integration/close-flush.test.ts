import { describe, expect, it } from 'bun:test';
import { KimiSessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, stubSession } from '../_helpers';

describe('Integration — Close & Flush', () => {
  it('correctly shuts down, flushes, updates database status, and unregisters session', async () => {
    const fake = makeFakeDb();
    const manager = new KimiSessionManager();

    // Select queue for close active session SELECT row in handleCloseSession/getForUser
    fake.selectQueue.push([
      {
        id: 'sess-close-1',
        userId: 'alice',
        workDir: '/tmp/work',
        kimiSessionId: 'kimi-x',
        status: 'active',
      },
    ]);

    const active = manager.register({
      sessionId: 'sess-close-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    setHandlerDeps({
      manager,
      db: fake.db,
      createKimi: (() => stubSession()) as any,
    });

    const ws = new FakeWS('alice');
    manager.attachWS(active, asWS(ws));

    // Send close message
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'close_session',
        sessionId: 'sess-close-1',
      }),
    );

    // Verify DB update is called to set status to 'closed'
    const updateCall = fake.calls.find(
      (c) => c.op === 'update' && (c.values as any).status === 'closed',
    );
    expect(updateCall).toBeDefined();

    // Verify WS got the closed event
    const closedEvent = ws
      .parsed()
      .find((m) => m.type === 'session_state' && (m.payload as any).state === 'closed');
    expect(closedEvent).toBeDefined();
    expect((closedEvent?.payload as any).reason).toBe('ws');

    // Verify unregistered from memory
    expect(manager.peek('sess-close-1')).toBeNull();

    // Clean up
    setHandlerDeps(null);
  });
});
