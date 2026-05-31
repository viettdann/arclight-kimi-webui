// In-memory, per-user rate limiter for provider `/test`.
//
// Single-instance deployment: a module-level Map is the correct model — no
// Redis, no cross-instance coordination. Two guarantees per user:
//   1. At most one in-flight test at a time (concurrency gate).
//   2. A minimum interval between the start of consecutive tests (cooldown).
// The in-flight slot is always released in a `finally`, so a thrown or failed
// test never wedges the user permanently.

/** Minimum gap between the start of two consecutive tests for the same user. */
export const MIN_INTERVAL_MS = 2_000;

interface UserState {
  /** True while a test is running for this user. */
  inFlight: boolean;
  /** Epoch ms of the most recent test start. Meaningful only when `started`. */
  lastStart: number;
  /** True once at least one test has started (clock-value-independent sentinel). */
  started: boolean;
}

const state = new Map<string, UserState>();

/**
 * Once the Map holds more than this many entries, prune the idle ones on the
 * next new-user insert. Keeps the structure bounded in a long-lived process —
 * an entry only matters while a test is in flight or within its cooldown.
 */
const SWEEP_THRESHOLD = 512;

/** Injectable clock so the cooldown path is testable without wall-clock sleeps. */
let now: () => number = Date.now;

/** Override the clock (tests only). Pass no argument to restore `Date.now`. */
export function setClock(clock?: () => number): void {
  now = clock ?? Date.now;
}

/** Clear all limiter state (tests only). */
export function resetLimiter(): void {
  state.clear();
}

/**
 * Drop entries that are neither in flight nor within their cooldown window.
 * Recreating such an entry fresh is behaviorally identical (a brand-new entry
 * has `started: false`, so its cooldown check is a no-op), so eviction is safe.
 */
function sweep(t: number): void {
  for (const [userId, s] of state) {
    if (!s.inFlight && t - s.lastStart >= MIN_INTERVAL_MS) {
      state.delete(userId);
    }
  }
}

function get(userId: string): UserState {
  let s = state.get(userId);
  if (!s) {
    if (state.size >= SWEEP_THRESHOLD) sweep(now());
    s = { inFlight: false, lastStart: 0, started: false };
    state.set(userId, s);
  }
  return s;
}

export type TestLimitResult<T> = { ok: false; error: 'rate_limited' } | { ok: true; value: T };

/**
 * Run `fn` under the per-user limit. Rejects with `rate_limited` when a test is
 * already in flight for the user, or when called within `MIN_INTERVAL_MS` of the
 * previous test's start. Otherwise reserves the slot, runs `fn`, and releases
 * the slot in a `finally` regardless of success or throw.
 */
export async function withTestLimit<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<TestLimitResult<T>> {
  const s = get(userId);

  if (s.inFlight) {
    return { ok: false, error: 'rate_limited' };
  }

  const t = now();
  if (s.started && t - s.lastStart < MIN_INTERVAL_MS) {
    return { ok: false, error: 'rate_limited' };
  }

  s.inFlight = true;
  s.started = true;
  s.lastStart = t;
  try {
    const value = await fn();
    return { ok: true, value };
  } finally {
    s.inFlight = false;
  }
}
