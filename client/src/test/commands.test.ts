import { describe, it, expect } from 'vitest';
import { classifyCommand, parseSlashCommand, BLACKLIST, UNSUPPORTED_HINT } from 'shared/commands';

describe('parseSlashCommand', () => {
  it('should return null for non-command strings', () => {
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('compact')).toBeNull();
  });

  it('should parse simple command without args, trimming leading/trailing whitespace', () => {
    expect(parseSlashCommand('/compact')).toEqual({ name: 'compact', arg: '' });
    expect(parseSlashCommand(' /compact ')).toEqual({ name: 'compact', arg: '' });
    expect(parseSlashCommand('/init')).toEqual({ name: 'init', arg: '' });
  });

  it('should parse command with args', () => {
    expect(parseSlashCommand('/compact focus')).toEqual({ name: 'compact', arg: 'focus' });
    expect(parseSlashCommand('/compact   with   multiple   spaces')).toEqual({
      name: 'compact',
      arg: 'with   multiple   spaces',
    });
  });

  it('should trim whitespace around command and args', () => {
    expect(parseSlashCommand(' /compact  ')).toEqual({ name: 'compact', arg: '' });
  });
});

describe('classifyCommand', () => {
  it('should return unsupported with correct hint for blacklisted commands', () => {
    expect(classifyCommand('clear')).toEqual({
      type: 'unsupported',
      hint: BLACKLIST.clear,
    });
    expect(classifyCommand('model')).toEqual({
      type: 'unsupported',
      hint: BLACKLIST.model,
    });
    expect(classifyCommand('config')).toEqual({
      type: 'unsupported',
      hint: UNSUPPORTED_HINT,
    });
  });

  it('should return passthrough for static supported commands', () => {
    expect(classifyCommand('compact')).toEqual({ type: 'passthrough' });
    expect(classifyCommand('init')).toEqual({ type: 'passthrough' });
  });

  it('should handle dynamic commands list when provided', () => {
    // If not in blacklist, but dynamic list is provided:
    // Present in dynamic list -> passthrough
    expect(classifyCommand('custom_tool', { dynamic: ['custom_tool', 'another_tool'] })).toEqual({
      type: 'passthrough',
    });

    // Absent from dynamic list -> unsupported
    expect(classifyCommand('unknown_tool', { dynamic: ['custom_tool'] })).toEqual({
      type: 'unsupported',
      hint: UNSUPPORTED_HINT,
    });
  });

  it('should default to passthrough for unknown commands when dynamic list is not provided', () => {
    expect(classifyCommand('some_random_command')).toEqual({ type: 'passthrough' });
  });
});
