import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { makeFakeDb } from '../_helpers';
import * as realFs from 'node:fs';
import * as realFsPromises from 'node:fs/promises';
import * as realLogger from '../../src/lib/logger';

let mockExists = false;
let mockSize = 0;
let mockContent = '';
const warnCalls: Array<{ payload: unknown; msg: unknown }> = [];

// Snapshot real exports before `mock.module` swaps the namespaces.
const originalExistsSync = realFs.existsSync;
const originalStat = realFsPromises.stat;
const originalReadFile = realFsPromises.readFile;
const originalOpen = realFsPromises.open;

mock.module('node:fs', () => {
  return {
    ...realFs,
    existsSync: (p: string) => {
      if (p.endsWith('wire.jsonl')) return mockExists;
      return originalExistsSync(p);
    },
  };
});

mock.module('node:fs/promises', () => {
  return {
    ...realFsPromises,
    stat: async (p: string) => {
      if (p.endsWith('wire.jsonl')) return { size: mockSize } as any;
      return originalStat(p);
    },
    readFile: async (p: string, encoding?: any) => {
      if (p.endsWith('wire.jsonl')) return Buffer.from(mockContent, 'utf8');
      return originalReadFile(p, encoding);
    },
    open: async (p: string, mode: string) => {
      if (p.endsWith('wire.jsonl') && mode === 'r') {
        return {
          read: async (buf: Buffer, offset: number, length: number, position: number) => {
            const chunk = mockContent.substring(position, position + length);
            buf.write(chunk, offset, 'utf8');
            return { bytesRead: chunk.length };
          },
          close: async () => {},
        } as any;
      }
      return originalOpen(p, mode);
    },
  };
});

mock.module('../../src/lib/logger', () => {
  return {
    ...realLogger,
    logger: {
      ...realLogger.logger,
      warn: (payload: unknown, msg?: unknown) => {
        warnCalls.push({ payload, msg });
      },
      error: () => {},
      info: () => {},
      debug: () => {},
    },
  };
});

const { reconcileOnStartup, catchUpWireBackup } = await import('../../src/services/reconcile');

beforeEach(() => {
  warnCalls.length = 0;
});

afterAll(() => {
  mock.restore();
});

describe('Integration — reconcileOnStartup', () => {
  it('correctly scans active sessions and catches up their offsets', async () => {
    const fake = makeFakeDb();

    // 1. SELECT query in reconcileOnStartup -> returns 1 active session row
    fake.selectQueue.push([
      {
        id: 'sess-active',
        workDir: '/tmp/work',
        kimiSessionId: 'kimi-session-active',
      },
    ]);

    // 2. SELECT query inside catchUpWireBackup (schema.kimiSessionFiles) -> returns offset 50
    fake.selectQueue.push([
      {
        offset: 50,
      },
    ]);

    mockExists = true;
    mockContent = 'a'.repeat(50) + 'NEW_DELTA_DATA\n';
    mockSize = mockContent.length; // 65

    await reconcileOnStartup({ db: fake.db });

    // Verify database inserts (should insert/onConflictDoUpdate the backup with the delta)
    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as any).wireJsonl).toBe('NEW_DELTA_DATA\n');
    expect((insertCall?.values as any).wireByteOffset).toBe(65);
    // The dropped `workDirHash` column must not appear on the catch-up payload.
    expect(Object.keys(insertCall?.values as object)).not.toContain('workDirHash');
  });

  it('leaves foreign rows untouched when local disk is absent but DB backup exists', async () => {
    const fake = makeFakeDb();

    // Active row whose cached workDir points to another machine's path.
    fake.selectQueue.push([
      {
        id: 'sess-foreign',
        workDir: '/legacy/foreign/path',
        kimiSessionId: 'kimi-session-foreign',
      },
    ]);

    // session_files row carrying a non-empty backup → dbHasBackup === true.
    fake.selectQueue.push([
      {
        offset: 120,
        wireLen: 120,
        ctxLen: 0,
        stateLen: 0,
      },
    ]);

    mockExists = false; // local disk wire missing — this is a foreign row.

    await reconcileOnStartup({ db: fake.db });

    // No adopt (no UPDATE), no zombie prune, no catch-up INSERT. The lazy
    // restore path runs on the next WS attach instead.
    expect(fake.calls.find((c) => c.op === 'update')).toBeUndefined();
    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
  });
});

describe('catchUpWireBackup — wire shrink guard', () => {
  it('skips and logs a warning when wire on disk is smaller than DB offset', async () => {
    const fake = makeFakeDb();

    mockContent = 'short\n';
    mockSize = mockContent.length; // 6

    await catchUpWireBackup({
      sessionRowId: 'sess-shrunk',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-session-shrunk',
      db: fake.db,
      prevOffset: 200,
    });

    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.payload).toEqual({
      sessionRowId: 'sess-shrunk',
      wireSize: 6,
      prevOffset: 200,
    });
    expect(warnCalls[0]?.msg).toBe('wire shrunk; skipping reconcile');
  });
});
