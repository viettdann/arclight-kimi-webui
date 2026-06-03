import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendWS } from '@/lib/ws-send';

// Capture the frames handed to the singleton socket without opening one.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/ws-client', () => ({ wsClient: { send } }));

const GUARD_MS = 1500;

// `lastSent` is module state that persists across tests; jump the clock past the
// guard window between tests so prior entries can't bleed in.
let clock = 0;

beforeEach(() => {
  vi.useFakeTimers();
  clock += 1_000_000;
  vi.setSystemTime(clock);
  send.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sendWS', () => {
  it('builds an envelope and forwards JSON to the socket', () => {
    sendWS('send_message', { text: 'hi' }, 's1');
    expect(send).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(send.mock.calls[0]![0] as string);
    expect(frame).toMatchObject({
      type: 'send_message',
      payload: { text: 'hi' },
      sessionId: 's1',
      seq: 0,
    });
    expect(typeof frame.timestamp).toBe('number');
  });

  it('does not debounce non-guarded types', () => {
    sendWS('send_message', { text: 'a' }, 's1');
    sendWS('send_message', { text: 'a' }, 's1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops a duplicate guarded frame within the guard window', () => {
    sendWS('start_session', { workDir: '/w' }, 's1');
    sendWS('start_session', { workDir: '/w' }, 's1');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('allows a guarded frame again after the window elapses', () => {
    sendWS('start_session', { workDir: '/w' }, 's1');
    vi.advanceTimersByTime(GUARD_MS + 1);
    sendWS('start_session', { workDir: '/w' }, 's1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('treats a different payload or session as a distinct intent', () => {
    sendWS('start_session', { workDir: '/w1' }, 's1');
    sendWS('start_session', { workDir: '/w2' }, 's1'); // different payload
    sendWS('start_session', { workDir: '/w1' }, 's2'); // different session
    expect(send).toHaveBeenCalledTimes(3);
  });
});
