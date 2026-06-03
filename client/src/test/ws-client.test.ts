import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wsClient } from '@/lib/ws-client';

// 4401 (auth gone) routes through the auth store; stub it to assert.
const { clearSession } = vi.hoisted(() => ({ clearSession: vi.fn() }));
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: { getState: () => ({ clearSession }) },
}));

type Cb = (ev: unknown) => void;

// Minimal WebSocket double: records instances and lets a test drive lifecycle
// events synchronously. Mirrors the readyState constants ws-client reads.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  send = vi.fn();
  private listeners: Record<string, Cb[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Cb) {
    (this.listeners[type] ??= []).push(cb);
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code });
  }

  private emit(type: string, ev: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open', new Event('open'));
  }

  // Server-side / transient drop: socket flips closed, then fires close.
  drop(code: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code });
  }

  message(data: unknown) {
    this.emit('message', { data });
  }
}

const last = () => MockWebSocket.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  // Deterministic backoff: random()=0.5 → jitter term (0.5*2-1)=0 → delay==exp.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  clearSession.mockClear();
});

afterEach(() => {
  wsClient.close(); // reset singleton back to a closed, timer-free state
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('wsClient lifecycle', () => {
  it('connects, fires open listeners, and reports isOpen', () => {
    const onOpen = vi.fn();
    wsClient.on('open', onOpen);
    wsClient.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    last().open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(wsClient.isOpen()).toBe(true);
  });

  it('connect is idempotent while open', () => {
    wsClient.connect();
    last().open();
    wsClient.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('only sends while the socket is OPEN', () => {
    wsClient.connect();
    const sock = last();
    wsClient.send('early'); // still CONNECTING
    expect(sock.send).not.toHaveBeenCalled();

    sock.open();
    wsClient.send('now');
    expect(sock.send).toHaveBeenCalledWith('now');
  });

  it('routes incoming messages to message listeners', () => {
    const onMsg = vi.fn();
    wsClient.on('message', onMsg);
    wsClient.connect();
    last().open();
    last().message('hello');
    expect(onMsg).toHaveBeenCalledWith({ data: 'hello' });
  });

  it('unsubscribe stops a listener from firing', () => {
    const onOpen = vi.fn();
    const off = wsClient.on('open', onOpen);
    off();
    wsClient.connect();
    last().open();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('wsClient reconnection', () => {
  it('reconnects after a transient close using exponential backoff', () => {
    wsClient.connect();
    last().open(); // resets attempt → 0
    expect(MockWebSocket.instances).toHaveLength(1);

    // First drop → 1000ms backoff.
    last().drop(1006);
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second consecutive drop (never opened) → 2000ms backoff.
    last().drop(1006);
    vi.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('halts on 4401 and clears the session — no reconnect', () => {
    wsClient.connect();
    last().drop(4401);
    expect(clearSession).toHaveBeenCalledWith('ws-4401');
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect on a clean 1000 close', () => {
    wsClient.connect();
    last().drop(1000);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('manual close cancels a pending reconnect', () => {
    wsClient.connect();
    last().open();
    last().drop(1006); // schedules a reconnect
    wsClient.close(); // should cancel it
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
