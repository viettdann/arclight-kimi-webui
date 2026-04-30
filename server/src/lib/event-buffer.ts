import type { WSMessage } from 'shared/types';

// Ring buffer of recent WS messages per session, used for reconnect replay.
// Capacity = 500 (per design doc). When client's lastSeq is older than the
// oldest seq still in buffer, server falls back to a fresh snapshot.
//
// Full implementation lands at MVP-5.

export interface EventBuffer {
  readonly capacity: number;
  readonly lastSeq: number;
  push(msg: WSMessage): void;
  since(seq: number): WSMessage[];
  reset(): void;
}

export function createEventBuffer(_capacity = 500): EventBuffer {
  throw new Error('createEventBuffer not implemented (MVP-5)');
}
