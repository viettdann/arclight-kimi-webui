import { afterAll, describe, expect, it, mock } from 'bun:test';
import { makeFakeDb, stubSession } from '../_helpers';
import { appendWireDelta } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
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

    mockWireContent = 'a'.repeat(100) + 'NEW_EVENT_DATA\n';
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

  it('resets wire content if wire file has shrunk (size < offset)', async () => {
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

    const insertCall = fake.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall?.values as any).wireJsonl).toBe('SHRUNK_CONTENT\n');
    expect((insertCall?.values as any).wireByteOffset).toBe(15);
  });
});
