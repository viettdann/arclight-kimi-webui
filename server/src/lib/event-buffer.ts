import type { WSMessage } from 'shared/types';

// Per-session ring buffer of recent outbound WS messages. On client reconnect
// with a known lastSeq, server replays messages where seq > lastSeq. If the
// gap exceeds capacity (or the buffer was reset on session restore), the
// caller falls back to a fresh snapshot.
//
// Capacity = 500 by design. push() assigns no seq itself; the caller (session
// manager / dispatcher) stamps seq before pushing so the seq monotonicity
// matches what the WS layer wrote out.

export interface EventBuffer {
  readonly capacity: number;
  readonly lastSeq: number;
  push(msg: WSMessage): void;
  since(seq: number): WSMessage[];
  reset(): void;
}

export function createEventBuffer(capacity = 500): EventBuffer {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`EventBuffer capacity must be a positive integer, got ${capacity}`);
  }

  const ring: WSMessage[] = [];
  let writeIdx = 0;
  let size = 0;
  let lastSeq = 0;

  return {
    capacity,
    get lastSeq() {
      return lastSeq;
    },
    push(msg) {
      ring[writeIdx] = msg;
      writeIdx = (writeIdx + 1) % capacity;
      if (size < capacity) size += 1;
      lastSeq = msg.seq;
    },
    since(seq) {
      if (size === 0) return [];
      const oldestIdx = size < capacity ? 0 : writeIdx;
      const oldest = ring[oldestIdx];
      if (oldest === undefined) return [];
      // Caller's lastSeq predates anything we still hold → diff cannot be
      // served from the buffer; caller should snapshot.
      if (seq < oldest.seq - 1) return [];
      const out: WSMessage[] = [];
      for (let i = 0; i < size; i++) {
        const slot = ring[(oldestIdx + i) % capacity];
        if (slot !== undefined && slot.seq > seq) out.push(slot);
      }
      return out;
    },
    reset() {
      ring.length = 0;
      writeIdx = 0;
      size = 0;
      lastSeq = 0;
    },
  };
}
