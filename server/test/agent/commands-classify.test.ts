import { describe, expect, it } from 'bun:test';
import { classifyCommand, UNSUPPORTED_HINT } from 'shared/commands';

// The shared classifier is the single source of truth for slash-command policy.
// These cases pin the branches the server dispatch guard relies on.

describe('classifyCommand', () => {
  it('blacklisted command → unsupported with its replacement hint', () => {
    const r = classifyCommand('clear');
    expect(r.type).toBe('unsupported');
    if (r.type === 'unsupported') expect(r.hint).toBe('Use New Session to start fresh.');
  });

  it('built-in passthrough (/compact) → passthrough', () => {
    expect(classifyCommand('compact').type).toBe('passthrough');
  });

  it('unknown name WITH a dynamic catalog → unsupported (generic hint)', () => {
    const r = classifyCommand('frobnicate', { dynamic: ['deploy', 'lint'] });
    expect(r.type).toBe('unsupported');
    if (r.type === 'unsupported') expect(r.hint).toBe(UNSUPPORTED_HINT);
  });

  it('unknown name with NO dynamic catalog (cold start) → passthrough', () => {
    expect(classifyCommand('frobnicate').type).toBe('passthrough');
  });

  it('a member of the dynamic catalog → passthrough', () => {
    expect(classifyCommand('deploy', { dynamic: ['deploy', 'lint'] }).type).toBe('passthrough');
  });
});
