import { describe, expect, it } from 'bun:test';
import type { ProviderModelInput } from 'shared/types/providers';
import type { ProviderRow } from '../../../src/db/schema';
import {
  createProvider,
  removeProvider,
  updateProvider,
} from '../../../src/services/providers/store';
import { type DbCall, makeFakeDb } from '../../_helpers';

// These tests assert CALL-SHAPE only (insert/update/delete sequence, dedupe,
// session cleanup, transaction wrapping). Real SQL/constraint semantics — the
// unique constraint, CHECKs, and FK SET NULL — are validated by applying the
// migration, not here.

const NOW = new Date('2026-01-01T00:00:00Z');

function makeRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'prov-1',
    ownerUserId: null,
    type: 'api',
    visibility: 'private',
    namespace: 'NS',
    baseUrl: null,
    token: 'tok',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const ops = (calls: DbCall[]) => calls.map((c) => c.op);
const tables = (calls: DbCall[]) => calls.map((c) => c.table);

// ─────────────────────────── createProvider ───────────────────────────

describe('createProvider', () => {
  it('runs inside a transaction and inserts provider then models', async () => {
    const fake = makeFakeDb();
    const models: ProviderModelInput[] = [{ modelId: 'm-1', isDefault: true }, { modelId: 'm-2' }];

    await createProvider(fake.db, {
      ownerUserId: null,
      type: 'api',
      visibility: 'private',
      namespace: 'NS',
      baseUrl: null,
      token: 'tok',
      models,
    });

    // Two inserts: providers, then provider_models.
    const inserts = fake.calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.table).toBe('providers');
    expect(inserts[1]?.table).toBe('provider_models');

    // The model insert carries both distinct rows.
    const modelValues = inserts[1]?.values as { modelId: string }[];
    expect(modelValues.map((m) => m.modelId)).toEqual(['m-1', 'm-2']);
  });

  it('dedupes repeated modelId, last write wins', async () => {
    const fake = makeFakeDb();
    const models: ProviderModelInput[] = [
      { modelId: 'dup', displayName: 'first', isDefault: false },
      { modelId: 'other' },
      { modelId: 'dup', displayName: 'last', isDefault: true },
    ];

    await createProvider(fake.db, {
      ownerUserId: null,
      type: 'api',
      visibility: 'private',
      namespace: 'NS',
      baseUrl: null,
      token: 'tok',
      models,
    });

    const inserts = fake.calls.filter((c) => c.op === 'insert');
    const modelValues = inserts[1]?.values as {
      modelId: string;
      displayName: string | null;
      isDefault: boolean;
    }[];
    // 'dup' collapses to a single row; 'last' wins.
    expect(modelValues).toHaveLength(2);
    const dup = modelValues.find((m) => m.modelId === 'dup');
    expect(dup?.displayName).toBe('last');
    expect(dup?.isDefault).toBe(true);
  });

  it('skips the model insert when there are no models', async () => {
    const fake = makeFakeDb();
    await createProvider(fake.db, {
      ownerUserId: 'u-1',
      type: 'api',
      visibility: null,
      namespace: 'NS',
      baseUrl: null,
      token: 'tok',
      models: [],
    });
    const inserts = fake.calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe('providers');
  });
});

// ─────────────────────────── updateProvider ───────────────────────────

describe('updateProvider', () => {
  it('returns null (no mutation) when the scoped row is absent', async () => {
    const fake = makeFakeDb();
    // selectQueue empty → existing lookup yields [] → null.
    const result = await updateProvider(fake.db, 'prov-1', { namespace: 'X' }, { builtin: true });
    expect(result).toBeNull();
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('replaces models inside a transaction: select, update, delete, insert', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeRow()]); // existing row lookup

    await updateProvider(
      fake.db,
      'prov-1',
      { namespace: 'Renamed', models: [{ modelId: 'm-a' }, { modelId: 'm-b' }] },
      { builtin: true },
    );

    // Sequence: select existing → update providers → delete models → insert models.
    expect(ops(fake.calls)).toEqual(['select', 'update', 'delete', 'insert']);
    expect(tables(fake.calls)).toEqual([
      'providers',
      'providers',
      'provider_models',
      'provider_models',
    ]);
  });

  it('dedupes patch models by modelId, last write wins', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeRow()]);

    await updateProvider(
      fake.db,
      'prov-1',
      {
        models: [
          { modelId: 'dup', displayName: 'first' },
          { modelId: 'dup', displayName: 'last' },
        ],
      },
      { ownerUserId: 'u-1' },
    );

    const insert = fake.calls.find((c) => c.op === 'insert');
    const values = insert?.values as { modelId: string; displayName: string | null }[];
    expect(values).toHaveLength(1);
    expect(values[0]?.displayName).toBe('last');
  });

  it('omitting models leaves provider_models untouched (no delete/insert)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([makeRow()]);

    await updateProvider(fake.db, 'prov-1', { namespace: 'Only' }, { builtin: true });

    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false);
    expect(fake.calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

// ─────────────────────────── removeProvider ───────────────────────────

describe('removeProvider', () => {
  it('nulls dependent session models BEFORE deleting the provider, in a transaction', async () => {
    const fake = makeFakeDb();
    await removeProvider(fake.db, 'prov-1', { builtin: true });

    // The session-model cleanup update must precede the provider delete.
    const updateIdx = fake.calls.findIndex((c) => c.op === 'update' && c.table === 'sessions');
    const deleteIdx = fake.calls.findIndex((c) => c.op === 'delete' && c.table === 'providers');
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeLessThan(deleteIdx);

    // The cleanup sets model = null.
    const update = fake.calls[updateIdx];
    expect((update?.values as { model: unknown }).model).toBeNull();
  });

  it('issues exactly one sessions update and one providers delete', async () => {
    const fake = makeFakeDb();
    await removeProvider(fake.db, 'prov-1', { ownerUserId: 'u-1' });

    expect(fake.calls.filter((c) => c.op === 'update' && c.table === 'sessions')).toHaveLength(1);
    expect(fake.calls.filter((c) => c.op === 'delete' && c.table === 'providers')).toHaveLength(1);
  });
});
