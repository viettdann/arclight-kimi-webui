import { describe, expect, it } from 'bun:test';
import { reapIdleQueries } from '../../src/services/agent/idle-reaper';
import type { ActiveSession } from '../../src/services/session-manager';
import { SessionManager } from '../../src/services/session-manager';

// reapIdleQueries disposes a session's live subprocess once it has been idle past
// the TTL, while skipping in-flight turns, pending approvals, and closing
// sessions. Disposal nulls the query/bridge/abortController so the next turn
// respawns — the session stays registered.

const TTL = 1000;
const NOW = 100_000;

interface Fakes {
  interrupted: boolean;
  aborted: boolean;
  bridgeClosed: boolean;
}

function liveSession(
  manager: SessionManager,
  id: string,
  overrides: Partial<ActiveSession> = {},
): { active: ActiveSession; fakes: Fakes } {
  const active = manager.register({ sessionId: id, userId: 'u1', workDir: `/tmp/${id}` });
  const fakes: Fakes = { interrupted: false, aborted: false, bridgeClosed: false };
  active.query = {
    interrupt: async () => {
      fakes.interrupted = true;
    },
  } as unknown as ActiveSession['query'];
  active.abortController = {
    abort: () => {
      fakes.aborted = true;
    },
  } as unknown as AbortController;
  active.bridge = {
    close: () => {
      fakes.bridgeClosed = true;
    },
  } as unknown as ActiveSession['bridge'];
  active.lastActivity = NOW - TTL - 1; // idle past TTL by default
  Object.assign(active, overrides);
  return { active, fakes };
}

describe('reapIdleQueries', () => {
  it('disposes a session idle past the TTL', async () => {
    const m = new SessionManager();
    const { active, fakes } = liveSession(m, 's-idle');

    await reapIdleQueries(m, TTL, NOW);

    expect(fakes.interrupted).toBe(true);
    expect(fakes.aborted).toBe(true);
    expect(fakes.bridgeClosed).toBe(true);
    expect(active.query).toBeNull();
    expect(active.bridge).toBeNull();
    expect(active.abortController).toBeNull();
    // The session itself stays registered (respawns lazily on the next turn).
    expect(m.peek('s-idle')).toBe(active);
  });

  it('skips a session still within the TTL', async () => {
    const m = new SessionManager();
    const { active, fakes } = liveSession(m, 's-fresh', { lastActivity: NOW - 1 });

    await reapIdleQueries(m, TTL, NOW);

    expect(fakes.aborted).toBe(false);
    expect(active.query).not.toBeNull();
  });

  it('never reaps an in-flight turn', async () => {
    const m = new SessionManager();
    const { active, fakes } = liveSession(m, 's-busy', { turnInProgress: true });

    await reapIdleQueries(m, TTL, NOW);

    expect(fakes.aborted).toBe(false);
    expect(active.query).not.toBeNull();
  });

  it('skips a session with a pending approval', async () => {
    const m = new SessionManager();
    const { active, fakes } = liveSession(m, 's-approval');
    active.pendingApprovals.set('req', {
      requestId: 'req',
      payload: {} as never,
      resolve: () => {},
    });

    await reapIdleQueries(m, TTL, NOW);

    expect(fakes.aborted).toBe(false);
    expect(active.query).not.toBeNull();
  });

  it('skips a session already being closed', async () => {
    const m = new SessionManager();
    const { fakes } = liveSession(m, 's-closing', { closing: true });

    await reapIdleQueries(m, TTL, NOW);

    expect(fakes.aborted).toBe(false);
  });

  it('ignores sessions with no live query', async () => {
    const m = new SessionManager();
    const active = m.register({ sessionId: 's-noq', userId: 'u1', workDir: '/tmp/s-noq' });
    active.lastActivity = NOW - TTL - 1;

    // No throw, nothing to dispose.
    await reapIdleQueries(m, TTL, NOW);
    expect(active.query).toBeNull();
  });
});
