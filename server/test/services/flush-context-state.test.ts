import { afterAll, describe, expect, it, mock } from 'bun:test';
import { makeFakeDb, stubSession } from '../_helpers';
import { flushContextAndState } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
import * as realFsPromises from 'node:fs/promises';

// Snapshot real export before `mock.module` swaps the namespace.
const originalReadFile = realFsPromises.readFile;

mock.module('node:fs/promises', () => {
  return {
    ...realFsPromises,
    readFile: async (p: string, encoding?: any) => {
      if (p.endsWith('context.jsonl')) {
        return '{"role":"user","content":"context_data"}\n';
      }
      if (p.endsWith('state.json')) {
        return '{"custom_title":"Mock Title"}';
      }
      return originalReadFile(p, encoding);
    },
  };
});

afterAll(() => {
  mock.restore();
});

describe('flushContextAndState', () => {
  it('reads context.jsonl and state.json and runs onConflictDoUpdate on DB', async () => {
    const fake = makeFakeDb();

    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    await flushContextAndState(active, fake.db);

    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as any).contextJsonl).toBe('{"role":"user","content":"context_data"}\n');
    expect((insertCall?.values as any).stateJson).toBe('{"custom_title":"Mock Title"}');
  });
});
