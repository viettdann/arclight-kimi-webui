import { afterEach, describe, expect, it } from 'bun:test';
import {
  canUserAccess,
  isAccessControlEnabled,
  isUserAllowed,
  setAccessControlResolver,
} from '../../src/auth/access';
import { makeFakeDb } from '../_helpers';

// ACCESS_CONTROL_ENABLED is unset in the test env, so its zod default ('true')
// is the env baseline these tests fall back to.

// After the migration to site_settings, resolveAccessControl delegates to an
// injected resolver. We wire a simple mock that reads from selectQueue like
// the old access_control tests did — each [{enabled: …}] pushed to
// selectQueue simulates a site_settings row for `access.enabled`.

function setupResolver(fake: ReturnType<typeof makeFakeDb>) {
  setAccessControlResolver(async () => {
    const rows = fake.selectQueue.shift();
    const raw = rows?.[0]?.enabled;
    const envDefault = true; // ACCESS_CONTROL_ENABLED defaults to 'true'
    const override = typeof raw === 'boolean' ? raw : null;
    return { override, envDefault, effective: override ?? envDefault };
  });
}

afterEach(() => {
  // Clear the resolver so tests don't leak into each other.
  setAccessControlResolver(null as never);
});

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
    setupResolver(fake);
    expect(await isAccessControlEnabled(fake.db)).toBe(true);
  });

  it('honors override = false', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: false }]);
    setupResolver(fake);
    expect(await isAccessControlEnabled(fake.db)).toBe(false);
  });

  it('falls back to env default when no row exists', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    setupResolver(fake);
    expect(await isAccessControlEnabled(fake.db)).toBe(true);
  });

  it('falls back to env default when enabled is null', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: null }]);
    setupResolver(fake);
    expect(await isAccessControlEnabled(fake.db)).toBe(true);
  });
});

describe('canUserAccess', () => {
  it('off → any session passes without an allowlist query', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: false }]);
    setupResolver(fake);
    expect(await canUserAccess(fake.db, { role: 'user', email: 'any@x.com' })).toBe(true);
    // The resolver mock handles the control read; the allowlist was never queried.
    expect(fake.calls.filter((c) => c.op === 'select').length).toBe(0);
  });

  it('on → listed user passes', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    setupResolver(fake);
    fake.selectQueue.push([{ email: 'user@x.com' }]); // allowlist
    expect(await canUserAccess(fake.db, { role: 'user', email: 'user@x.com' })).toBe(true);
  });

  it('on → unlisted user is rejected', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]);
    setupResolver(fake);
    fake.selectQueue.push([]);
    expect(await canUserAccess(fake.db, { role: 'user', email: 'nope@x.com' })).toBe(false);
  });

  it('on → admin always passes', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ enabled: true }]); // control
    setupResolver(fake);
    expect(await canUserAccess(fake.db, { role: 'admin', email: 'admin@x.com' })).toBe(true);
  });
});
