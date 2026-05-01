import type {
  ApprovalResponse,
  ContentPart,
  RunResult,
  Session,
  StreamEvent,
  Turn,
} from '@moonshot-ai/kimi-agent-sdk';
import type { ServerWebSocket } from 'bun';
import type { WSMessage } from 'shared/types';
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

// ─────────────────────────── Stub Kimi Session ───────────────────────────

export interface StubSessionOptions {
  sessionId?: string;
  workDir?: string;
}

export function stubSession(opts: StubSessionOptions = {}): Session {
  const stub = {
    sessionId: opts.sessionId ?? 'kimi-stub-session',
    workDir: opts.workDir ?? '/tmp/work',
    state: 'idle',
    slashCommands: [],
    model: undefined,
    thinking: false,
    yoloMode: false,
    executable: '',
    env: {},
    externalTools: [],
    planMode: false,
    setPlanMode: async () => false,
    prompt: () => {
      throw new Error('stubSession: prompt not implemented');
    },
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  };
  return stub as unknown as Session;
}

// ─────────────────────────── Controlled Turn ───────────────────────────

export interface ControlledTurn {
  turn: Turn;
  push(ev: StreamEvent): void;
  end(result: RunResult): void;
  approveCalls: Array<{ requestId: string; response: ApprovalResponse }>;
  interruptCalls: number;
}

/**
 * A `Turn` whose iterator yields events on demand. Tests push events
 * synchronously, then call `end(result)` to terminate the iterator and
 * resolve `turn.result`. Simulates the SDK pump shape end-to-end.
 */
export function makeControlledTurn(): ControlledTurn {
  const queue: StreamEvent[] = [];
  let signaledEnd = false;
  let result: RunResult | null = null;
  const waiters: Array<(v: IteratorResult<StreamEvent, RunResult>) => void> = [];
  let resolveResultPromise: (r: RunResult) => void = () => {};
  const resultP = new Promise<RunResult>((res) => {
    resolveResultPromise = res;
  });

  const drain = () => {
    while (waiters.length > 0) {
      if (queue.length > 0) {
        const fn = waiters.shift();
        const ev = queue.shift();
        if (fn && ev !== undefined) fn({ done: false, value: ev });
      } else if (signaledEnd && result !== null) {
        const fn = waiters.shift();
        if (fn) fn({ done: true, value: result });
      } else {
        break;
      }
    }
  };

  const iter: AsyncIterator<StreamEvent, RunResult, undefined> = {
    next(): Promise<IteratorResult<StreamEvent, RunResult>> {
      return new Promise((res) => {
        waiters.push(res);
        drain();
      });
    },
  };

  const approveCalls: ControlledTurn['approveCalls'] = [];
  let interruptCalls = 0;

  const turn = {
    [Symbol.asyncIterator]: () => iter,
    result: resultP,
    interrupt: async () => {
      interruptCalls += 1;
    },
    approve: async (requestId: string, response: ApprovalResponse) => {
      approveCalls.push({ requestId, response });
    },
    respondQuestion: async () => {},
    steer: async (_content: string | ContentPart[]) => {},
  } as unknown as Turn;

  return {
    turn,
    push(ev: StreamEvent) {
      queue.push(ev);
      drain();
    },
    end(r: RunResult) {
      result = r;
      signaledEnd = true;
      resolveResultPromise(r);
      drain();
    },
    approveCalls,
    get interruptCalls() {
      return interruptCalls;
    },
  };
}

// ─────────────────────────── Recording fake DB ───────────────────────────

export interface DbCall {
  op: 'insert' | 'update' | 'select';
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
          returning: () => Promise.resolve([{ id: `fake-${calls.length}` }]),
          onConflictDoUpdate: () => Promise.resolve(),
        });
      },
    }),
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
  };
  return {
    db: fake as unknown as DB,
    calls,
    selectQueue,
  };
}
