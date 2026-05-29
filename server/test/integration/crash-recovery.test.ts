import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realFsPromises from 'node:fs/promises';
import * as realLogger from '../../src/lib/logger';
import { makeFakeDb } from '../_helpers';

let mockWireSize = 0;
let mockWireContent = '';
const warnCalls: Array<{ payload: unknown; msg: unknown }> = [];

// Snapshot real exports before `mock.module` swaps the namespace.
const originalStat = realFsPromises.stat;
const originalOpen = realFsPromises.open;
const originalReadFile = realFsPromises.readFile;

mock.module('node:fs/promises', () => {
  return {
    ...realFsPromises,
    stat: async (p: string) => {
      if (p.endsWith('wire.jsonl')) {
        return { size: mockWireSize } as any;
      }
      return originalStat(p);
    },
    open: async (p: string, mode: string) => {
      if (p.endsWith('wire.jsonl') && mode === 'r') {
        return {
          read: async (buf: Buffer, offset: number, length: number, position: number) => {
            const chunk = mockWireContent.substring(position, position + length);
            buf.write(chunk, offset, 'utf8');
            return { bytesRead: chunk.length };
          },
          close: async () => {},
        } as any;
      }
      return originalOpen(p, mode);
    },
    readFile: async (p: string, encoding?: any) => {
      if (p.endsWith('wire.jsonl')) {
        return Buffer.from(mockWireContent, 'utf8');
      }
      return originalReadFile(p, encoding);
    },
  };
});

mock.module('../../src/lib/logger', () => ({
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
}));

const { catchUpWireBackup } = await import('../../src/services/reconcile');

beforeEach(() => {
  warnCalls.length = 0;
});

afterAll(() => {
  mock.restore();
});

describe('Integration — Crash Recovery', () => {
  it('correctly catches up when DB lags behind disk wire size', async () => {
    const fake = makeFakeDb();

    mockWireContent = `${'a'.repeat(50)}CRASH_RECOVERY_DELTA\n`;
    mockWireSize = mockWireContent.length; // 71

    await catchUpWireBackup({
      sessionRowId: 'sess-crash-1',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-crash-1',
      db: fake.db,
      prevOffset: 50,
    });

    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as any).wireJsonl).toBe('CRASH_RECOVERY_DELTA\n');
    expect((insertCall?.values as any).wireByteOffset).toBe(71);
  });

  it('skips and logs a warning when DB offset is larger than disk wire size (e.g. disk truncated)', async () => {
    const fake = makeFakeDb();

    mockWireContent = 'TRUNCATED_WIRE_FILE\n';
    mockWireSize = mockWireContent.length; // 20

    await catchUpWireBackup({
      sessionRowId: 'sess-crash-2',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-crash-2',
      db: fake.db,
      prevOffset: 100,
    });

    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.payload).toEqual({
      sessionRowId: 'sess-crash-2',
      wireSize: 20,
      prevOffset: 100,
    });
    expect(warnCalls[0]?.msg).toBe('wire shrunk; skipping reconcile');
  });
});
