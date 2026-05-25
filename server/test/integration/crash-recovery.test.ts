import { afterAll, describe, expect, it, mock } from 'bun:test';
import { makeFakeDb } from '../_helpers';
import { catchUpWireBackup } from '../../src/services/reconcile';
import * as realFsPromises from 'node:fs/promises';

let mockWireSize = 0;
let mockWireContent = '';

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

afterAll(() => {
  mock.restore();
});

describe('Integration — Crash Recovery', () => {
  it('correctly catches up when DB lags behind disk wire size', async () => {
    const fake = makeFakeDb();

    mockWireContent = 'a'.repeat(50) + 'CRASH_RECOVERY_DELTA\n';
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

  it('correctly resets when DB offset is larger than disk wire size (e.g. disk truncated)', async () => {
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

    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as any).wireJsonl).toBe('TRUNCATED_WIRE_FILE\n');
    expect((insertCall?.values as any).wireByteOffset).toBe(20);
  });
});
