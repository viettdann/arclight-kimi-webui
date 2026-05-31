import { afterEach, describe, expect, it } from 'bun:test';
import {
  MIN_INTERVAL_MS,
  resetLimiter,
  setClock,
  withTestLimit,
} from '../../../src/services/providers/test-limiter';

// Deterministic clock: tests advance it manually, never sleep on wall-clock.
let clock = 0;
setClock(() => clock);

afterEach(() => {
  resetLimiter();
  clock = 0;
});

describe('withTestLimit', () => {
  it('rejects a concurrent second call while one is in flight', async () => {
    // Hold the first call open with a manually-resolved promise so a second
    // call observes the in-flight slot deterministically (no timing race).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withTestLimit('user-a', async () => {
      await gate;
      return 'first';
    });

    // While `first` is awaiting the gate, the slot is held.
    const second = await withTestLimit('user-a', async () => 'second');
    expect(second).toEqual({ ok: false, error: 'rate_limited' });

    release();
    const firstResult = await first;
    expect(firstResult).toEqual({ ok: true, value: 'first' });
  });

  it('rejects a call within the minimum interval of the previous start', async () => {
    const r1 = await withTestLimit('user-b', async () => 'ok');
    expect(r1).toEqual({ ok: true, value: 'ok' });

    // Same instant (and any time < MIN_INTERVAL_MS later) is within cooldown.
    clock += MIN_INTERVAL_MS - 1;
    const r2 = await withTestLimit('user-b', async () => 'ok');
    expect(r2).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('allows a call after the slot is released and the interval has elapsed', async () => {
    const r1 = await withTestLimit('user-c', async () => 'ok');
    expect(r1).toEqual({ ok: true, value: 'ok' });

    clock += MIN_INTERVAL_MS;
    const r2 = await withTestLimit('user-c', async () => 'ok');
    expect(r2).toEqual({ ok: true, value: 'ok' });
  });

  it('releases the in-flight slot when fn throws', async () => {
    const r1 = await withTestLimit('user-d', async () => {
      throw new Error('boom');
    }).catch((err) => err);
    // The rejection propagates, but the slot must be freed.
    expect(r1).toBeInstanceOf(Error);

    // Advance past the cooldown; a subsequent call must be allowed, proving the
    // throw did not wedge the user.
    clock += MIN_INTERVAL_MS;
    const r2 = await withTestLimit('user-d', async () => 'ok');
    expect(r2).toEqual({ ok: true, value: 'ok' });
  });

  it('keeps per-user state independent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = withTestLimit('user-e', async () => {
      await gate;
      return 'e';
    });

    // A different user is unaffected by user-e's in-flight slot.
    const f = await withTestLimit('user-f', async () => 'f');
    expect(f).toEqual({ ok: true, value: 'f' });

    release();
    expect(await a).toEqual({ ok: true, value: 'e' });
  });
});
