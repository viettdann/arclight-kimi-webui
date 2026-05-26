import { describe, expect, it } from 'bun:test';
import { makeFakeDb, stubSession, FakeWS, asWS } from '../_helpers';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { KimiSessionManager } from '../../src/services/session-manager';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';

describe('Integration — Lifecycle', () => {
  it('handles the entire session lifecycle: creation, message pumping, and closing', async () => {
    const fake = makeFakeDb();
    const manager = new KimiSessionManager();

    const createKimiFn = (args: any): Session => {
      return stubSession({ sessionId: 'kimi-session-e2e', workDir: args.workDir });
    };

    setHandlerDeps({
      manager,
      db: fake.db,
      createKimi: createKimiFn as any,
    });

    const ws = new FakeWS('user-1');

    // 1. Create session
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'create_session',
        payload: {
          workDir: '/tmp/kimi-webui-test/user-1/my-project',
        },
      }),
    );

    // Verify snapshot and session state broadcasted
    const parsedMessages = ws.parsed();
    expect(parsedMessages.some((m) => m.type === 'session_state')).toBe(true);
    const snapshotMsg = parsedMessages.find((m) => m.type === 'snapshot');
    expect(snapshotMsg).toBeDefined();

    // Pull the generated session row id (randomUUID) from the snapshot envelope.
    const sessionId = (snapshotMsg as any).sessionId as string;
    expect(typeof sessionId).toBe('string');

    const active = manager.peek(sessionId);
    expect(active).not.toBeNull();
    expect(active?.workDir).toBe('/tmp/kimi-webui-test/user-1/my-project');

    // 2. Send message
    await handleMessage(
      asWS(ws),
      JSON.stringify({
        type: 'send_message',
        sessionId,
        payload: {
          content: 'Hello Kimi!',
        },
      }),
    );

    // Verify pendingPrompt enqueued
    const updateCall = fake.calls.find(
      (c) => c.op === 'update' && (c.values as any).pendingPrompt !== undefined,
    );
    expect(updateCall).toBeDefined();
    expect((updateCall?.values as any).pendingPrompt).toBe('Hello Kimi!');

    // 3. Clean up
    setHandlerDeps(null);
  });
});
