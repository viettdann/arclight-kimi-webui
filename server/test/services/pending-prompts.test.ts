import { describe, expect, it } from 'bun:test';
import {
  clearPendingPrompt,
  enqueuePendingPrompt,
  peekPendingPrompt,
} from '../../src/services/pending-prompts';
import { makeFakeDb } from '../_helpers';

describe('pending-prompts DB logic', () => {
  it('enqueuePendingPrompt constructs correct update query', async () => {
    const fake = makeFakeDb();
    await enqueuePendingPrompt('sess-A', 'Hello Kimi', fake.db);

    const updateCall = fake.calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect((updateCall?.values as any).pendingPrompt).toBe('Hello Kimi');
    expect((updateCall?.values as any).pendingEnqueuedAt).toBeInstanceOf(Date);
  });

  it('clearPendingPrompt constructs correct clear update query', async () => {
    const fake = makeFakeDb();
    await clearPendingPrompt('sess-A', fake.db);

    const updateCall = fake.calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect((updateCall?.values as any).pendingPrompt).toBeNull();
    expect((updateCall?.values as any).pendingEnqueuedAt).toBeNull();
  });

  it('peekPendingPrompt resolves correctly when prompt is present', async () => {
    const fake = makeFakeDb();
    const date = new Date();
    fake.selectQueue.push([
      {
        pendingPrompt: 'Resilient prompt text',
        pendingEnqueuedAt: date,
      },
    ]);

    const result = await peekPendingPrompt('sess-A', fake.db);
    expect(result).not.toBeNull();
    expect(result?.text).toBe('Resilient prompt text');
    expect(result?.enqueuedAt).toEqual(date);

    const selectCall = fake.calls.find((c) => c.op === 'select');
    expect(selectCall).toBeDefined();
  });

  it('peekPendingPrompt returns null when prompt is absent', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        pendingPrompt: null,
        pendingEnqueuedAt: null,
      },
    ]);

    const result = await peekPendingPrompt('sess-A', fake.db);
    expect(result).toBeNull();
  });
});
