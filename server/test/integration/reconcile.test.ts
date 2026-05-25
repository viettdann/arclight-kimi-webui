import { afterAll, describe, expect, it, mock } from 'bun:test';
import { makeFakeDb } from '../_helpers';
import { reconcileOnStartup } from '../../src/services/reconcile';
import * as realFs from 'node:fs';
import * as realFsPromises from 'node:fs/promises';

let mockExists = false;
let mockSize = 0;
let mockContent = '';

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

    // 2. SELECT query inside catchUpWireBackup (schema.sessionFiles) -> returns offset 50
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
  });
});
