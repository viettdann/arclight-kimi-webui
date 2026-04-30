import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import type { ServerWebSocket } from 'bun';
import type { ErrorPayload, WSMessage } from 'shared/types';
import type { DB } from '../src/db';
import { KimiSessionManager } from '../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../src/ws/handlers';
import type { WSData } from '../src/ws/upgrade';

// Authz tests for the WS handlers. Cross-user access and malformed payloads
// must short-circuit BEFORE any DB or SDK call. We inject a stub DB that
// throws on first access — if it ever fires, the handler fell through too far.

const stubKimi = {} as unknown as Session;

const trapDb = new Proxy(
  {},
  {
    get() {
      throw new Error('trapDb: DB must not be hit on authz/bad-request paths');
    },
  },
) as unknown as DB;

class FakeWS {
  readyState = 1;
  data: WSData;
  sent: string[] = [];
  constructor(userId: string) {
    this.data = { userId, userSlug: userId, authSessionId: `auth-${userId}` };
  }
  send(payload: string): number {
    this.sent.push(payload);
    return payload.length;
  }
  close(): void {}
  lastError(): WSMessage<ErrorPayload> | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const parsed = JSON.parse(this.sent[i] ?? '') as WSMessage;
      if (parsed.type === 'error') return parsed as WSMessage<ErrorPayload>;
    }
    return null;
  }
}

function asWS(f: FakeWS): ServerWebSocket<WSData> {
  return f as unknown as ServerWebSocket<WSData>;
}

let manager: KimiSessionManager;

beforeEach(() => {
  manager = new KimiSessionManager();
  setHandlerDeps({ manager, db: trapDb });
});

afterEach(() => {
  setHandlerDeps(null);
});

function registerOwnedSession(userId: string, sessionId: string): void {
  manager.register({
    sessionId,
    userId,
    workDir: '/tmp/work',
    kimiSessionId: `kimi-${sessionId}`,
    kimiSession: stubKimi,
  });
}

async function send(ws: FakeWS, msg: object): Promise<void> {
  await handleMessage(asWS(ws), JSON.stringify(msg));
}

describe('handlers authz — cross-user access returns not_found uniformly', () => {
  it('send_message from foreign user → not_found', async () => {
    registerOwnedSession('alice', 'sess-A');
    const bob = new FakeWS('bob');
    await send(bob, {
      type: 'send_message',
      sessionId: 'sess-A',
      payload: { content: 'hi' },
    });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });

  it('send_message to non-existent session → not_found (same shape)', async () => {
    const bob = new FakeWS('bob');
    await send(bob, {
      type: 'send_message',
      sessionId: 'ghost-session',
      payload: { content: 'hi' },
    });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });

  it('approve_tool from foreign user → not_found', async () => {
    registerOwnedSession('alice', 'sess-A');
    const bob = new FakeWS('bob');
    await send(bob, {
      type: 'approve_tool',
      sessionId: 'sess-A',
      payload: { requestId: 'req-1', response: 'approve' },
    });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });

  it('interrupt_turn from foreign user → not_found', async () => {
    registerOwnedSession('alice', 'sess-A');
    const bob = new FakeWS('bob');
    await send(bob, { type: 'interrupt_turn', sessionId: 'sess-A' });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });

  it('close_session from foreign user → not_found', async () => {
    registerOwnedSession('alice', 'sess-A');
    const bob = new FakeWS('bob');
    await send(bob, { type: 'close_session', sessionId: 'sess-A' });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });

  it('subscribe to foreign session → not_found', async () => {
    registerOwnedSession('alice', 'sess-A');
    const bob = new FakeWS('bob');
    await send(bob, { type: 'subscribe', payload: { sessionId: 'sess-A' } });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });

  it('resume_session for foreign session → not_found', async () => {
    registerOwnedSession('alice', 'sess-A');
    const bob = new FakeWS('bob');
    await send(bob, { type: 'resume_session', payload: { sessionId: 'sess-A' } });
    expect(bob.lastError()?.payload.code).toBe('not_found');
  });
});

describe('handlers authz — bad payloads return bad_request', () => {
  it('approve_tool with invalid response value → bad_request', async () => {
    registerOwnedSession('alice', 'sess-A');
    const alice = new FakeWS('alice');
    await send(alice, {
      type: 'approve_tool',
      sessionId: 'sess-A',
      payload: { requestId: 'req-1', response: 'always_allow' /* not in SDK enum */ },
    });
    expect(alice.lastError()?.payload.code).toBe('bad_request');
  });

  it('approve_tool with missing requestId → bad_request', async () => {
    registerOwnedSession('alice', 'sess-A');
    const alice = new FakeWS('alice');
    await send(alice, {
      type: 'approve_tool',
      sessionId: 'sess-A',
      payload: { response: 'approve' },
    });
    expect(alice.lastError()?.payload.code).toBe('bad_request');
  });

  it('send_message with empty content → bad_request', async () => {
    registerOwnedSession('alice', 'sess-A');
    const alice = new FakeWS('alice');
    await send(alice, {
      type: 'send_message',
      sessionId: 'sess-A',
      payload: { content: '' },
    });
    expect(alice.lastError()?.payload.code).toBe('bad_request');
  });

  it('non-JSON body → bad_message', async () => {
    const alice = new FakeWS('alice');
    await handleMessage(asWS(alice), 'not-json{');
    expect(alice.lastError()?.payload.code).toBe('bad_message');
  });

  it('unknown type → bad_message', async () => {
    const alice = new FakeWS('alice');
    await send(alice, { type: 'frobnicate', payload: {} });
    expect(alice.lastError()?.payload.code).toBe('bad_message');
  });

  it('create_session with non-absolute workDir → bad_request', async () => {
    const alice = new FakeWS('alice');
    await send(alice, { type: 'create_session', payload: { workDir: 'relative/path' } });
    expect(alice.lastError()?.payload.code).toBe('bad_request');
  });

  it('create_session with workDir outside user root → bad_request', async () => {
    const alice = new FakeWS('alice');
    await send(alice, { type: 'create_session', payload: { workDir: '/etc/passwd' } });
    expect(alice.lastError()?.payload.code).toBe('bad_request');
  });
});
