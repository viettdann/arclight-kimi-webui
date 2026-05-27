import { describe, expect, it } from 'bun:test';
import { canUserAccess, isAccessControlEnabled, isUserAllowed } from '../../src/auth/access';
import { makeFakeDb } from '../_helpers';

// ACCESS_CONTROL_ENABLED is unset in the test env, so its zod default ('true')
// is the env baseline these tests fall back to.

describe('isUserAllowed', () => {
  it('admin bypasses the allowlist without querying', async () => {
    const fake = makeFakeDb();
    const ok = await isUserAllowed(fake.db, { role: 'admin', email: 'admin@x.com' });
    expect(ok).toBe(true);
    expect(fake.calls.length).toBe(0);
  });

  it('returns true when the email is listed', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ email: 'user@x.com' }]);
    expect(await isUserAllowed(fake.db, { role: 'user', email: 'user@x.com' })).toBe(true);
  });

  it('returns false when the email is not listed', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    expect(await isUserAllowed(fake.db, { role: 'user', email: 'nope@x.com' })).toBe(false);
  });
});

describe('isAccessControlEnabled', () => {
  it('honors override = true', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]);
    expect(await isAccessControlEnabled(fake.db)).toBe(true);
  });

  it('honors override = false', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: false }]);
    expect(await isAccessControlEnabled(fake.db)).toBe(false);
  });

  it('falls back to env default when no row exists', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    expect(await isAccessControlEnabled(fake.db)).toBe(true);
  });

  it('falls back to env default when enabled is null', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: null }]);
    expect(await isAccessControlEnabled(fake.db)).toBe(true);
  });
});

describe('canUserAccess', () => {
  it('off → any session passes without an allowlist query', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: false }]); // control row
    expect(await canUserAccess(fake.db, { role: 'user', email: 'any@x.com' })).toBe(true);
    // Only the control row was read; the allowlist was never queried.
    expect(fake.calls.filter((c) => c.op === 'select').length).toBe(1);
  });

  it('on → listed user passes', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    fake.selectQueue.push([{ email: 'user@x.com' }]); // allowlist
    expect(await canUserAccess(fake.db, { role: 'user', email: 'user@x.com' })).toBe(true);
  });

  it('on → unlisted user is rejected', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]);
    fake.selectQueue.push([]);
    expect(await canUserAccess(fake.db, { role: 'user', email: 'nope@x.com' })).toBe(false);
  });

  it('on → admin always passes', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    expect(await canUserAccess(fake.db, { role: 'admin', email: 'admin@x.com' })).toBe(true);
  });
});
