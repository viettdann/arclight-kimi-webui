import { afterEach, describe, expect, it } from 'bun:test';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, wsErrors } from '../_helpers';

// The client heartbeat sends `{type:'ping'}` to detect a silently-dropped
// (zombie) socket. The server's only job is to bounce a `pong` straight back —
// session-agnostic, no DB, no side effects. The reply is what proves liveness;
// the client treats ANY inbound frame as the pong.

afterEach(() => {
  setHandlerDeps(null);
});

describe('handleMessage — ping/pong', () => {
  it('replies with a single pong and no error', async () => {
    const ws = new FakeWS('alice');
    await handleMessage(asWS(ws), JSON.stringify({ type: 'ping', payload: {}, sessionId: '' }));

    const frames = ws.parsed();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('pong');
    expect(frames[0]?.sessionId).toBe('');
    expect(wsErrors(ws)).toHaveLength(0);
  });

  it('does not touch the socket lifecycle (no close)', async () => {
    const ws = new FakeWS('alice');
    await handleMessage(asWS(ws), JSON.stringify({ type: 'ping' }));

    expect(ws.closeCalls).toHaveLength(0);
    expect(ws.readyState).toBe(1);
  });
});
