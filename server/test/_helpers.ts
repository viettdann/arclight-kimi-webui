import type { ServerWebSocket } from 'bun';
import type { ErrorPayload, WSMessage } from 'shared/types';
import type { DB } from '../src/db';
import type { WSData } from '../src/ws/upgrade';

// ─────────────────────────── Fake WebSocket ───────────────────────────

export class FakeWS {
  readyState = 1;
  data: WSData;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  constructor(userId: string, userSlug?: string) {
    this.data = {
      userId,
      userSlug: userSlug ?? userId,
      authSessionId: `auth-${userId}`,
      lastValidatedAt: Date.now(),
    };
  }
  send(payload: string): number {
    this.sent.push(payload);
    return payload.length;
  }
  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }
  parsed(): WSMessage[] {
    return this.sent.map((s) => JSON.parse(s) as WSMessage);
  }
}

export function asWS(f: FakeWS): ServerWebSocket<WSData> {
  return f as unknown as ServerWebSocket<WSData>;
}

/** Convenience: pull every `error`-typed envelope out of a FakeWS, typed. */
export function wsErrors(ws: FakeWS): WSMessage<ErrorPayload>[] {
  return ws.parsed().filter((m) => m.type === 'error') as WSMessage<ErrorPayload>[];
}

// ─────────────────────────── Recording fake DB ───────────────────────────

export interface DbCall {
  op: 'insert' | 'update' | 'select' | 'delete';
  table?: string;
  values?: unknown;
}

export interface FakeDb {
  db: DB;
  calls: DbCall[];
  /** Override the next `select(...).from(...).where(...).limit(...)` result. */
  selectQueue: unknown[][];
}

/**
 * Drizzle-shaped fake. Records every mutating call and returns empty result
 * sets by default. Tests prime `selectQueue` with rows for queries — each
 * select query consumes exactly one queue entry on its terminal `await`.
 *
 * Supported chains:
 *   db.insert(t).values(v)                        → resolves void
 *   db.insert(t).values(v).returning({...})       → [{id}]
 *   db.insert(t).values(v).onConflictDoUpdate(.)  → resolves void
 *   db.update(t).set(v).where(.)                  → resolves void
 *   db.select().from(t).where(.).limit(n)         → selectQueue.shift() ?? []
 *   db.select().from(t).where(.).orderBy(.)       → selectQueue.shift() ?? []
 *   db.select().from(t).where(.).orderBy(.).limit(n) → same as above
 */
export function makeFakeDb(): FakeDb {
  const calls: DbCall[] = [];
  const selectQueue: unknown[][] = [];

  const makeSelectChain = (): unknown => {
    const chain: Record<string, unknown> = {};
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.innerJoin = () => chain;
    chain.leftJoin = () => chain;
    // biome-ignore lint/suspicious/noThenProperty: drizzle-shape thenable test fake.
    chain.then = (onF: (v: unknown[]) => unknown, onR: (e: unknown) => unknown) => {
      const rows = selectQueue.shift() ?? [];
      return Promise.resolve(rows).then(onF, onR);
    };
    return chain;
  };

  const fake = {
    insert: (table: { _: { name?: string } } & object) => ({
      values: (v: unknown) => {
        calls.push({
          op: 'insert',
          table: (table as { _?: { name?: string } })?._?.name,
          values: v,
        });
        const ret = Promise.resolve();
        return Object.assign(ret, {
          returning: () =>
            Promise.resolve([
              {
                ...(v as Record<string, unknown>),
                id: (v as Record<string, unknown>).id ?? `fake-${calls.length}`,
              },
            ]),
          onConflictDoUpdate: () => Promise.resolve(),
          onConflictDoNothing: () => Promise.resolve(),
        });
      },
    }),
    delete: (table: { _: { name?: string } } & object) => {
      calls.push({ op: 'delete', table: (table as { _?: { name?: string } })?._?.name });
      return { where: () => Promise.resolve() };
    },
    update: (table: { _: { name?: string } } & object) => ({
      set: (v: unknown) => {
        calls.push({
          op: 'update',
          table: (table as { _?: { name?: string } })?._?.name,
          values: v,
        });
        return { where: () => Promise.resolve() };
      },
    }),
    select: (..._args: unknown[]) => ({
      from: (table: { _: { name?: string } } & object) => {
        calls.push({ op: 'select', table: (table as { _?: { name?: string } })?._?.name });
        return makeSelectChain();
      },
    }),
    selectDistinct: (..._args: unknown[]) => ({
      from: (table: { _: { name?: string } } & object) => {
        calls.push({ op: 'select', table: (table as { _?: { name?: string } })?._?.name });
        return makeSelectChain();
      },
    }),
    execute: (_sql: unknown) => Promise.resolve([] as unknown[]),
  };
  return {
    db: fake as unknown as DB,
    calls,
    selectQueue,
  };
}
