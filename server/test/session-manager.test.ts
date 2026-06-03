import { describe, expect, it } from 'bun:test';
import { SessionManager } from '../src/services/session-manager';

function mgr() {
  return new SessionManager();
}

function reg(m: SessionManager, sessionId: string, userId: string) {
  return m.register({
    sessionId,
    userId,
    workDir: '/tmp/work',
  });
}

describe('SessionManager', () => {
  it('rejects cross-user sessionId access', () => {
    const m = mgr();
    reg(m, 'sess-A', 'user-1');
    expect(m.getForUser('user-1', 'sess-A')).not.toBeNull();
    // Foreign user must get null — and the API must not distinguish "exists
    // but not yours" from "doesn't exist".
    expect(m.getForUser('user-2', 'sess-A')).toBeNull();
    expect(m.getForUser('user-2', 'no-such-id')).toBeNull();
  });

  it('isolates byUser map per userId', () => {
    const m = mgr();
    reg(m, 's1', 'u1');
    reg(m, 's2', 'u1');
    reg(m, 's3', 'u2');
    expect(new Set(m.listForUser('u1'))).toEqual(new Set(['s1', 's2']));
    expect(m.listForUser('u2')).toEqual(['s3']);
    expect(m.listForUser('u3')).toEqual([]);
  });

  it('removes session from byUser on unregister; cleans empty user entries', () => {
    const m = mgr();
    reg(m, 's1', 'u1');
    reg(m, 's2', 'u1');
    m.unregister('s1');
    expect(m.listForUser('u1')).toEqual(['s2']);
    m.unregister('s2');
    expect(m.listForUser('u1')).toEqual([]);
    expect(m.size).toBe(0);
    // Re-registering a previously-removed id must work without leftover state.
    reg(m, 's1', 'u1');
    expect(m.getForUser('u1', 's1')).not.toBeNull();
  });

  it('rejects duplicate register', () => {
    const m = mgr();
    reg(m, 's1', 'u1');
    expect(() => reg(m, 's1', 'u1')).toThrow();
    // Even a different user re-using the same sessionId is rejected — ids are
    // global UUIDs so collision means a manager bug.
    expect(() => reg(m, 's1', 'u2')).toThrow();
  });

  it('unregister of unknown id is a no-op returning null', () => {
    const m = mgr();
    expect(m.unregister('ghost')).toBeNull();
  });

  it('allocSeq is monotonic per session and updates lastActivity', () => {
    const m = mgr();
    const a = reg(m, 's1', 'u1');
    const t0 = a.lastActivity;
    expect(m.allocSeq(a)).toBe(1);
    expect(m.allocSeq(a)).toBe(2);
    expect(a.lastSeq).toBe(2);
    expect(a.lastActivity).toBeGreaterThanOrEqual(t0);
  });
});
