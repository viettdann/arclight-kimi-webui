import { describe, expect, it } from 'bun:test';
import { errSerializer } from '../src/lib/logger';

// Reproduces the DrizzleQueryError → PostgresError wrapping: Drizzle bubbles a
// "Failed query" Error whose `.cause` is the real driver error with structured
// fields. The std serializer drops those fields; errSerializer must surface them.
function drizzleWrap(cause: object): Error {
  return Object.assign(new Error('Failed query: select ...'), { query: 'select ...', cause });
}

describe('errSerializer', () => {
  it('surfaces structured Postgres fields from a wrapped cause', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      severity: 'ERROR',
      detail: 'Key (email)=(a@b.com) already exists.',
      constraint: 'user_email_unique',
      table: 'user',
      column: 'email',
    });
    const out = errSerializer(drizzleWrap(pgError)) as Record<string, unknown>;

    expect(out.pg).toMatchObject({
      code: '23505',
      detail: 'Key (email)=(a@b.com) already exists.',
      constraint: 'user_email_unique',
      table: 'user',
      column: 'email',
      message: 'duplicate key value violates unique constraint',
    });
    // The Drizzle query context is preserved by the std serializer.
    expect(out.query).toBe('select ...');
  });

  it('handles a top-level driver error (no wrapping)', () => {
    const out = errSerializer(
      Object.assign(new Error('write CONNECTION_CLOSED'), { code: 'CONNECTION_CLOSED' }),
    ) as Record<string, unknown>;
    expect(out.pg).toMatchObject({ code: 'CONNECTION_CLOSED' });
    // No wrapping → message stays on the top-level serialized error, not duplicated into pg.
    expect((out.pg as Record<string, unknown>).message).toBeUndefined();
  });

  it('omits pg for ordinary errors', () => {
    const out = errSerializer(new Error('plain boom')) as Record<string, unknown>;
    expect(out.pg).toBeUndefined();
    expect(out.message).toBe('plain boom');
  });
});
