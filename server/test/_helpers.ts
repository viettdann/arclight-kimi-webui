import type { ServerWebSocket } from 'bun';
import { getTableName, type Table } from 'drizzle-orm';
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

/** Resolve a Drizzle table's SQL name via the library's public accessor. */
function tableName(table: object | undefined): string | undefined {
  return table ? getTableName(table as Table) : undefined;
}

/**
 * Drizzle-shaped fake. Records every mutating call and returns empty result
 * sets by default. Tests prime `selectQueue` with rows for queries — each
 * select query consumes exactly one queue entry on its terminal `await`.
 *
 * Supported chains:
 *   db.insert(t).values(v)                        → resolves void
 *   db.insert(t).values(v).returning({...})       → [{...v, id}]
 *   db.insert(t).values(v).onConflictDoUpdate(.)  → resolves void
 *   db.update(t).set(v).where(.)                  → resolves void
 *   db.update(t).set(v).where(.).returning()      → [{...v, id}]
 *   db.delete(t).where(.)                         → resolves void
 *   db.delete(t).where(.).returning()             → [{id}]
 *   db.select().from(t).where(.).limit(n)         → selectQueue.shift() ?? []
 *   db.select().from(t).where(.).orderBy(.)       → selectQueue.shift() ?? []
 *   db.select().from(t).where(.).orderBy(.).limit(n) → same as above
 *   db.transaction(cb)                            → cb(fake) (inner ops recorded)
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
          table: tableName(table),
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
      calls.push({ op: 'delete', table: tableName(table) });
      // `.where(.)` resolves void, or `.where(.).returning()` yields the deleted
      // rows (one synthetic row, so `.length > 0` reports a successful delete).
      const afterWhere = Object.assign(Promise.resolve(), {
        returning: () => Promise.resolve([{ id: 'deleted' }]),
      });
      return { where: () => afterWhere };
    },
    update: (table: { _: { name?: string } } & object) => ({
      set: (v: unknown) => {
        calls.push({
          op: 'update',
          table: tableName(table),
          values: v,
        });
        // `.where(.)` resolves void, or `.where(.).returning()` yields the
        // updated row (echo the set values plus a synthetic id).
        const afterWhere = Object.assign(Promise.resolve(), {
          returning: () =>
            Promise.resolve([
              {
                ...(v as Record<string, unknown>),
                id: (v as Record<string, unknown>).id ?? `fake-${calls.length}`,
              },
            ]),
        });
        return { where: () => afterWhere };
      },
    }),
    select: (..._args: unknown[]) => ({
      from: (table: { _: { name?: string } } & object) => {
        calls.push({ op: 'select', table: tableName(table) });
        return makeSelectChain();
      },
    }),
    selectDistinct: (..._args: unknown[]) => ({
      from: (table: { _: { name?: string } } & object) => {
        calls.push({ op: 'select', table: tableName(table) });
        return makeSelectChain();
      },
    }),
    execute: (_sql: unknown) => Promise.resolve([] as unknown[]),
    // Run the callback with the fake itself as `tx`. Inner ops record into the
    // same `calls`/`selectQueue`, so transaction call-shape is observable.
    transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(fake),
  };
  return {
    db: fake as unknown as DB,
    calls,
    selectQueue,
  };
}
