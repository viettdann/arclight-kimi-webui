import { describe, expect, it } from 'bun:test';
import { DEFAULT_PROJECT_DISCOVERY_BLACKLIST } from 'shared/types';
import {
  effectiveBlacklist,
  getProjectDiscoveryConfig,
  SITE_SETTING_KEYS,
  setProjectDiscoveryConfig,
} from '../../src/services/site-settings';
import { makeFakeDb } from '../_helpers';

const ENTRIES_KEY = SITE_SETTING_KEYS.projectDiscoveryEntries;
const OVERRIDE_KEY = SITE_SETTING_KEYS.projectDiscoveryOverride;

describe('getProjectDiscoveryConfig', () => {
  it('falls back to defaults when no rows exist', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    expect(await getProjectDiscoveryConfig(fake.db)).toEqual({ entries: [], override: false });
  });

  it('reads both keys when present', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      { key: ENTRIES_KEY, value: ['a', 'b'] },
      { key: OVERRIDE_KEY, value: true },
    ]);
    expect(await getProjectDiscoveryConfig(fake.db)).toEqual({
      entries: ['a', 'b'],
      override: true,
    });
  });

  it('defaults override to false when only the entries row exists', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ key: ENTRIES_KEY, value: ['x'] }]);
    expect(await getProjectDiscoveryConfig(fake.db)).toEqual({ entries: ['x'], override: false });
  });

  it('drops non-string entries and coerces non-true override to false', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      { key: ENTRIES_KEY, value: ['ok', 5, null, 'fine'] },
      { key: OVERRIDE_KEY, value: 'yes' },
    ]);
    expect(await getProjectDiscoveryConfig(fake.db)).toEqual({
      entries: ['ok', 'fine'],
      override: false,
    });
  });
});

describe('setProjectDiscoveryConfig', () => {
  it('upserts the two rows in a single batched insert', async () => {
    const fake = makeFakeDb();
    await setProjectDiscoveryConfig(fake.db, { entries: ['foo'], override: true });

    const inserts = fake.calls.filter((c) => c.op === 'insert');
    expect(inserts.length).toBe(1);
    expect(inserts[0]?.values).toEqual([
      { key: ENTRIES_KEY, value: ['foo'] },
      { key: OVERRIDE_KEY, value: true },
    ]);
  });
});

describe('effectiveBlacklist', () => {
  it('append mode unions defaults with entries', () => {
    const set = effectiveBlacklist({ entries: ['custom'], override: false });
    expect(set.has('custom')).toBe(true);
    for (const def of DEFAULT_PROJECT_DISCOVERY_BLACKLIST) {
      expect(set.has(def)).toBe(true);
    }
  });

  it('override mode uses only the entries', () => {
    const set = effectiveBlacklist({ entries: ['custom'], override: true });
    expect(set.has('custom')).toBe(true);
    expect(set.has('.git')).toBe(false);
  });
});
