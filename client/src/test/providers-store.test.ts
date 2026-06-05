import type { AvailableProvidersResponse, ProviderDTO } from 'shared/types/providers';
import { describe, expect, it } from 'vitest';
import { isResolvable, labelFor } from '@/lib/providers-store';

// labelFor reads only id / namespace / models[].{ modelId, displayName }.
const provider = (
  id: string,
  namespace: string,
  models: { modelId: string; displayName: string | null }[],
): ProviderDTO =>
  ({
    id,
    namespace,
    models: models.map((m) => ({ ...m, id: m.modelId, contextWindow: null, isDefault: false })),
  }) as ProviderDTO;

const available: AvailableProvidersResponse = {
  builtin: [provider('p-anthropic', 'anthropic', [{ modelId: 'claude-x', displayName: 'Opus' }])],
  personal: [provider('p-self', 'me', [{ modelId: 'local-model', displayName: null }])],
};

describe('labelFor', () => {
  it('resolves a builtin pair to namespace/displayName', () => {
    expect(labelFor(available, 'p-anthropic', 'claude-x')).toBe('anthropic/Opus');
  });

  it('falls back to modelId when displayName is null', () => {
    expect(labelFor(available, 'p-self', 'local-model')).toBe('me/local-model');
  });

  it('returns null when any input is missing', () => {
    expect(labelFor(null, 'p-anthropic', 'claude-x')).toBeNull();
    expect(labelFor(available, null, 'claude-x')).toBeNull();
    expect(labelFor(available, 'p-anthropic', null)).toBeNull();
  });

  it('returns null for an unknown provider or model', () => {
    expect(labelFor(available, 'ghost', 'claude-x')).toBeNull();
    expect(labelFor(available, 'p-anthropic', 'ghost-model')).toBeNull();
  });
});

describe('isResolvable', () => {
  it('is true exactly when the pair resolves', () => {
    expect(isResolvable(available, 'p-anthropic', 'claude-x')).toBe(true);
    expect(isResolvable(available, 'p-self', 'local-model')).toBe(true);
  });

  it('is false for unresolvable or missing input', () => {
    expect(isResolvable(available, 'p-anthropic', 'ghost-model')).toBe(false);
    expect(isResolvable(null, 'p-anthropic', 'claude-x')).toBe(false);
    expect(isResolvable(available, null, null)).toBe(false);
  });
});
