import type { ServerWebSocket } from 'bun';
import type { WSData } from './upgrade';

// In-process registry of every authenticated WebSocket. Single-instance
// only — no cross-process coordination. Heartbeat snapshots this set every
// 60s to revalidate auth sessions; upgrade.ts and index.ts maintain it.

const sockets = new Set<ServerWebSocket<WSData>>();

export function registerSocket(ws: ServerWebSocket<WSData>): void {
  sockets.add(ws);
}

export function unregisterSocket(ws: ServerWebSocket<WSData>): void {
  sockets.delete(ws);
}

/** Point-in-time copy. Heartbeat iterates this without holding a live ref. */
export function snapshot(): ServerWebSocket<WSData>[] {
  return Array.from(sockets);
}

/** Diagnostic. Not used in hot paths. */
export function size(): number {
  return sockets.size;
}
