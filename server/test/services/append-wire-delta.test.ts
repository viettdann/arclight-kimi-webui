import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realFsPromises from 'node:fs/promises';
import * as realLogger from '../../src/lib/logger';
import { makeFakeDb, stubSession } from '../_helpers';

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

// Import AFTER mock.module so the module under test resolves the mocked logger.
const { appendWireDelta } = await import('../../src/services/kimi-session');
const { KimiSessionManager } = await import('../../src/services/session-manager');

beforeEach(() => {
  warnCalls.length = 0;
});

afterAll(() => {
  mock.restore();
});

describe('appendWireDelta', () => {
  it('does nothing if wire file size equals database offset', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ offset: 100 }]); // DB offset

    mockWireSize = 100;
    mockWireContent = 'a'.repeat(100);

    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    await appendWireDelta(active, false, fake.db);

    const insertCalls = fake.calls.filter((c) => c.op === 'insert');
    expect(insertCalls.length).toBe(0);
  });

  it('appends delta when size is larger and force is true', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ offset: 100 }]); // DB offset

    mockWireContent = `${'a'.repeat(100)}NEW_EVENT_DATA\n`;
    mockWireSize = mockWireContent.length; // 115

    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    await appendWireDelta(active, true, fake.db); // force=true

    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as any).wireJsonl).toBe('NEW_EVENT_DATA\n');
    expect((insertCall?.values as any).wireByteOffset).toBe(115);
  });

  it('logs warning and skips when wire file has shrunk (size < offset)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ offset: 200 }]); // DB offset was 200, but file shrunk!

    mockWireContent = 'SHRUNK_CONTENT\n';
    mockWireSize = mockWireContent.length; // 15

    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    await appendWireDelta(active, true, fake.db);

    expect(fake.calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.payload).toEqual({
      sessionId: 'sess-1',
      wireSize: 15,
      prevOffset: 200,
    });
    expect(warnCalls[0]?.msg).toBe('wire shrunk; skipping append');
  });
});
