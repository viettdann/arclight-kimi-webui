import { describe, expect, it } from 'bun:test';
import { dbErrorCode, isTransientDbError, logDbError } from '../src/db/errors';

// Mimics how Drizzle wraps the postgres.js cause inside DrizzleQueryError.
function wrap(code: string): Error {
  const cause = Object.assign(new Error('write CONNECTION_CLOSED'), { code });
  return Object.assign(new Error('Failed query'), { cause });
}

describe('dbErrorCode', () => {
  it('reads a top-level code', () => {
    expect(dbErrorCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('ECONNRESET');
  });

  it('walks the cause chain', () => {
    expect(dbErrorCode(wrap('CONNECTION_CLOSED'))).toBe('CONNECTION_CLOSED');
  });

  it('returns undefined when no code present', () => {
    expect(dbErrorCode(new Error('plain'))).toBeUndefined();
    expect(dbErrorCode(null)).toBeUndefined();
  });
});

describe('isTransientDbError', () => {
  it('flags postgres.js driver codes (sleep/wake)', () => {
    expect(isTransientDbError(wrap('CONNECTION_CLOSED'))).toBe(true);
    expect(isTransientDbError(wrap('CONNECT_TIMEOUT'))).toBe(true);
  });

  it('flags Node socket errnos', () => {
    expect(isTransientDbError(wrap('ECONNRESET'))).toBe(true);
    expect(isTransientDbError(wrap('ETIMEDOUT'))).toBe(true);
  });

  it('flags Postgres connectivity SQLSTATE', () => {
    expect(isTransientDbError(wrap('08006'))).toBe(true); // connection_failure
    expect(isTransientDbError(wrap('57P03'))).toBe(true); // cannot_connect_now
  });

  it('does NOT flag real query faults', () => {
    expect(isTransientDbError(wrap('23505'))).toBe(false); // unique_violation
    expect(isTransientDbError(wrap('42601'))).toBe(false); // syntax_error
    expect(isTransientDbError(new Error('boom'))).toBe(false);
  });
});

describe('logDbError', () => {
  function fakeLogger() {
    const warn: unknown[][] = [];
    const error: unknown[][] = [];
    return {
      warn: (...a: unknown[]) => warn.push(a),
      error: (...a: unknown[]) => error.push(a),
      _warn: warn,
      _error: error,
    };
  }

  it('logs transient blips at warn (code only, no stack)', () => {
    const log = fakeLogger();
    logDbError(log as never, wrap('CONNECTION_CLOSED'), { authSessionId: 'a1' }, 'revalidate');
    expect(log._error).toHaveLength(0);
    expect(log._warn).toHaveLength(1);
    expect(log._warn[0]?.[0]).toMatchObject({ code: 'CONNECTION_CLOSED', authSessionId: 'a1' });
    expect(log._warn[0]?.[0]).not.toHaveProperty('err');
  });

  it('logs real faults at error with the err object', () => {
    const log = fakeLogger();
    const err = wrap('23505');
    logDbError(log as never, err, { sessionId: 's1' }, 'pumpTurn');
    expect(log._warn).toHaveLength(0);
    expect(log._error).toHaveLength(1);
    expect(log._error[0]?.[0]).toMatchObject({ err, sessionId: 's1' });
  });
});
