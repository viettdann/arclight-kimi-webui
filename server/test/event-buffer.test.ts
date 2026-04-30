import { describe, expect, it } from 'bun:test';
import type { WSMessage } from 'shared/types';
import { createEventBuffer } from '../src/lib/event-buffer';

function msg(seq: number): WSMessage<{ seq: number }> {
  return {
    type: 'text_delta',
    payload: { seq },
    sessionId: 's1',
    seq,
    timestamp: 0,
  };
}

describe('EventBuffer', () => {
  it('rejects non-positive capacity', () => {
    expect(() => createEventBuffer(0)).toThrow();
    expect(() => createEventBuffer(-1)).toThrow();
    expect(() => createEventBuffer(1.5)).toThrow();
  });

  it('lastSeq starts at 0 and tracks last push', () => {
    const buf = createEventBuffer(4);
    expect(buf.lastSeq).toBe(0);
    buf.push(msg(1));
    buf.push(msg(2));
    expect(buf.lastSeq).toBe(2);
  });

  it('since(seq) returns only messages with seq > arg, in order', () => {
    const buf = createEventBuffer(4);
    [1, 2, 3].forEach((s) => {
      buf.push(msg(s));
    });
    expect(buf.since(0).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(buf.since(1).map((m) => m.seq)).toEqual([2, 3]);
    expect(buf.since(3)).toEqual([]);
  });

  it('drops oldest when capacity exceeded', () => {
    const buf = createEventBuffer(3);
    [1, 2, 3, 4, 5].forEach((s) => {
      buf.push(msg(s));
    });
    expect(buf.lastSeq).toBe(5);
    // oldest retained is seq 3; caller at seq 2 fits exactly.
    expect(buf.since(2).map((m) => m.seq)).toEqual([3, 4, 5]);
    expect(buf.since(4).map((m) => m.seq)).toEqual([5]);
  });

  it('returns empty when caller lastSeq predates the oldest retained seq', () => {
    const buf = createEventBuffer(3);
    [10, 11, 12, 13, 14].forEach((s) => {
      buf.push(msg(s));
    });
    // oldest in buffer is seq 12. Caller stuck on seq 5 cannot recover from buffer.
    expect(buf.since(5)).toEqual([]);
    // Edge: seq exactly oldest-1 still served (gap fits).
    expect(buf.since(11).map((m) => m.seq)).toEqual([12, 13, 14]);
  });

  it('reset clears state', () => {
    const buf = createEventBuffer(3);
    [1, 2].forEach((s) => {
      buf.push(msg(s));
    });
    buf.reset();
    expect(buf.lastSeq).toBe(0);
    expect(buf.since(0)).toEqual([]);
    buf.push(msg(1));
    expect(buf.lastSeq).toBe(1);
  });
});
