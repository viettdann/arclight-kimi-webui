import { describe, expect, it } from 'bun:test';
import { sanitizeStateJson, stripSystemPromptHead } from '../../src/services/restore-transforms';

describe('stripSystemPromptHead', () => {
  it('drops a single leading _system_prompt line', () => {
    const input = '{"role":"_system_prompt","content":"foo"}\n{"role":"user","content":"hi"}\n';
    const out = stripSystemPromptHead(input);
    expect(out).toBe('{"role":"user","content":"hi"}\n');
  });

  it('drops consecutive _system_prompt lines with blank lines between', () => {
    const input =
      '{"role":"_system_prompt","content":"A"}\n' +
      '\n' +
      '{"role":"_system_prompt","content":"B"}\n' +
      '\n' +
      '{"role":"user","content":"hi"}\n';
    const out = stripSystemPromptHead(input);
    expect(out).toBe('{"role":"user","content":"hi"}\n');
  });

  it('returns input unchanged when first JSON line is not _system_prompt', () => {
    const input = '{"role":"user","content":"hi"}\n';
    expect(stripSystemPromptHead(input)).toBe(input);
  });

  it('returns empty input unchanged', () => {
    expect(stripSystemPromptHead('')).toBe('');
  });

  it('returns input unchanged when first non-empty line is not JSON', () => {
    const input = 'not-json\n{"role":"user","content":"hi"}\n';
    expect(stripSystemPromptHead(input)).toBe(input);
  });

  it('preserves trailing newline when stripping', () => {
    const input = '{"role":"_system_prompt"}\n{"role":"user"}\n';
    expect(stripSystemPromptHead(input)).toBe('{"role":"user"}\n');
  });

  it('preserves trailing newline when passing through unchanged', () => {
    const input = '{"role":"user"}\n';
    expect(stripSystemPromptHead(input)).toBe(input);
  });
});

describe('sanitizeStateJson', () => {
  it('clears additional_dirs while preserving other fields', () => {
    const input = JSON.stringify({
      custom_title: 'hello',
      additional_dirs: ['/a', '/b'],
      foo: 1,
    });
    const out = sanitizeStateJson(input);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ custom_title: 'hello', additional_dirs: [], foo: 1 });
  });

  it('returns empty input unchanged', () => {
    expect(sanitizeStateJson('')).toBe('');
  });

  it('returns stub {} for malformed JSON so foreign additional_dirs cannot leak', () => {
    expect(sanitizeStateJson('{not valid')).toBe('{}');
  });

  it('returns stub {} for non-object JSON (array/scalar)', () => {
    expect(sanitizeStateJson('[1,2,3]')).toBe('{}');
    expect(sanitizeStateJson('"raw"')).toBe('{}');
  });

  it('inserts additional_dirs=[] when field is missing', () => {
    const input = JSON.stringify({ custom_title: 'hi' });
    const out = sanitizeStateJson(input);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ custom_title: 'hi', additional_dirs: [] });
  });
});
