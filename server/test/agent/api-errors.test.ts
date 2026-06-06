import { describe, expect, it } from 'bun:test';
import { normalizeApiError } from '../../src/services/agent/api-errors';

const NORMALIZED =
  'Ultracode requires an xhigh-capable model. This provider only supports low/medium/high effort — turn Ultracode off or switch model.';

describe('normalizeApiError', () => {
  it('normalizes the raw 400 mentioning output_config.effort and xhigh', () => {
    const raw =
      'API Error: 400 The parameter `output_config.effort` specified in the request are not valid: expected `low`, `medium`, `high` or `max`, but got `xhigh` instead.';
    expect(normalizeApiError(raw)).toBe(NORMALIZED);
  });

  it('normalizes when the rejected value is max', () => {
    const raw =
      'API Error: 400 The parameter `output_config.effort` is not valid: got `max` instead.';
    expect(normalizeApiError(raw)).toBe(NORMALIZED);
  });

  it('normalizes regardless of surrounding text as long as both tokens are present', () => {
    expect(normalizeApiError('output_config.effort rejected: xhigh')).toBe(NORMALIZED);
  });

  it('leaves an unrelated 400 untouched', () => {
    const raw = 'API Error: 400 The parameter `model` specified in the request is not valid.';
    expect(normalizeApiError(raw)).toBe(raw);
  });

  it('does not match output_config.effort without xhigh/max (e.g. a low-effort message)', () => {
    const raw = 'output_config.effort expected `low`, `medium`, `high` but got `extreme` instead.';
    expect(normalizeApiError(raw)).toBe(raw);
  });

  it('does not match a bare xhigh mention without output_config.effort', () => {
    const raw = 'Something about xhigh that is unrelated to effort config.';
    expect(normalizeApiError(raw)).toBe(raw);
  });

  it('passes through ordinary error strings', () => {
    const raw = 'API Error: Request rejected (429) · rate limit exceeded';
    expect(normalizeApiError(raw)).toBe(raw);
  });
});
