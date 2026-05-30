import { describe, expect, it } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { broadcastEvent, sendDirect } from '../src/lib/ws-broadcast';
import { SessionManager } from '../src/services/session-manager';
import type { WSData } from '../src/ws/upgrade';

// Pure-logic tests: no DB, no SDK. We attach fake sockets to a real
// SessionManager and verify broadcastEvent stamps a monotonic seq and fans out
// to every OPEN socket while skipping CLOSED ones.

class FakeWS {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(payload: string): number {
    this.sent.push(payload);
    return payload.length;
  }
}

function asWS(fake: FakeWS): ServerWebSocket<WSData> {
  return fake as unknown as ServerWebSocket<WSData>;
}

function setup(sessionId: string) {
  const manager = new SessionManager();
  const active = manager.register({
    sessionId,
    userId: 'u1',
    workDir: '/tmp/work',
  });
  return { manager, active };
}

describe('broadcastEvent', () => {
  it('assigns monotonic seq', () => {
    const { manager, active } = setup('s1');
    const ws = new FakeWS();
    manager.attachWS(active, asWS(ws));

    const m1 = broadcastEvent(active, 'text_delta', { text: 'a' }, manager);
    const m2 = broadcastEvent(active, 'text_delta', { text: 'b' }, manager);

    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
    expect(active.lastSeq).toBe(2);
  });

  it('fans out to every attached socket', () => {
    const { manager, active } = setup('s1');
    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    const ws3 = new FakeWS();
    manager.attachWS(active, asWS(ws1));
    manager.attachWS(active, asWS(ws2));
    manager.attachWS(active, asWS(ws3));

    broadcastEvent(active, 'turn_begin', { userInput: 'hi' }, manager);

    for (const ws of [ws1, ws2, ws3]) {
      expect(ws.sent.length).toBe(1);
      const parsed = JSON.parse(ws.sent[0] ?? '');
      expect(parsed.type).toBe('turn_begin');
      expect(parsed.payload).toEqual({ userInput: 'hi' });
      expect(parsed.sessionId).toBe('s1');
      expect(parsed.seq).toBe(1);
      expect(typeof parsed.timestamp).toBe('number');
    }
  });

  it('skips sockets where readyState !== OPEN', () => {
    const { manager, active } = setup('s1');
    const open = new FakeWS();
    const closing = new FakeWS();
    closing.readyState = 2; // CLOSING
    const closed = new FakeWS();
    closed.readyState = 3; // CLOSED
    manager.attachWS(active, asWS(open));
    manager.attachWS(active, asWS(closing));
    manager.attachWS(active, asWS(closed));

    broadcastEvent(active, 'text_delta', { text: 'x' }, manager);

    expect(open.sent.length).toBe(1);
    expect(closing.sent.length).toBe(0);
    expect(closed.sent.length).toBe(0);
  });

  it('continues fanout when one socket throws on send', () => {
    const { manager, active } = setup('s1');
    const good = new FakeWS();
    const bad = {
      readyState: 1,
      sent: [] as string[],
      send() {
        throw new Error('socket dead');
      },
    };
    manager.attachWS(active, asWS(good));
    manager.attachWS(active, asWS(bad as unknown as FakeWS));

    expect(() => broadcastEvent(active, 'text_delta', { text: 'y' }, manager)).not.toThrow();
    expect(good.sent.length).toBe(1);
  });

  it('per-session seq is independent across sessions', () => {
    const manager = new SessionManager();
    const a = manager.register({
      sessionId: 'sA',
      userId: 'u',
      workDir: '/a',
    });
    const b = manager.register({
      sessionId: 'sB',
      userId: 'u',
      workDir: '/b',
    });
    broadcastEvent(a, 'text_delta', { text: '1' }, manager);
    broadcastEvent(b, 'text_delta', { text: '2' }, manager);
    broadcastEvent(a, 'text_delta', { text: '3' }, manager);
    expect(a.lastSeq).toBe(2);
    expect(b.lastSeq).toBe(1);
  });
});

describe('sendDirect', () => {
  it('writes to OPEN socket without buffering or seq-stamping', () => {
    const ws = new FakeWS();
    const msg = {
      type: 'replay_done' as const,
      payload: { lastSeq: 7 },
      sessionId: 's1',
      seq: 0,
      timestamp: 123,
    };
    sendDirect(asWS(ws), msg);
    expect(ws.sent).toEqual([JSON.stringify(msg)]);
  });

  it('no-ops on CLOSED socket', () => {
    const ws = new FakeWS();
    ws.readyState = 3;
    sendDirect(asWS(ws), {
      type: 'error',
      payload: { code: 'x', message: 'x', retryable: false },
      sessionId: 's1',
      seq: 0,
      timestamp: 0,
    });
    expect(ws.sent.length).toBe(0);
  });
});
