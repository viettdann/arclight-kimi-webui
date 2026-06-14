import { describe, expect, test } from 'bun:test';
import {
  parseSkillMd,
  SkillParseError,
  validateSkillName,
} from '../../src/services/skills/frontmatter';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseSkillMd', () => {
  test('valid name + frontmatter description', () => {
    const md = '---\nname: my-skill\ndescription: A handy skill\n---\n\nBody text.\n';
    const res = parseSkillMd(enc(md));
    expect(res.name).toBe('my-skill');
    expect(res.description).toBe('A handy skill');
  });

  test('description falls back to first non-empty body line when no frontmatter description', () => {
    const md = '---\nname: my-skill\n---\n\n\nFirst real line.\nSecond line.\n';
    const res = parseSkillMd(enc(md));
    expect(res.name).toBe('my-skill');
    expect(res.description).toBe('First real line.');
  });

  test('empty frontmatter description falls back to body', () => {
    const md = '---\nname: my-skill\ndescription: "   "\n---\nBody first.\n';
    const res = parseSkillMd(enc(md));
    expect(res.description).toBe('Body first.');
  });

  test('CRLF line endings in the fence parse correctly', () => {
    const md = '---\r\nname: crlf-skill\r\ndescription: Works with CRLF\r\n---\r\nBody.\r\n';
    const res = parseSkillMd(enc(md));
    expect(res.name).toBe('crlf-skill');
    expect(res.description).toBe('Works with CRLF');
  });

  test('missing fence throws SkillParseError', () => {
    const md = 'name: my-skill\ndescription: no fence here\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });

  test('missing name throws SkillParseError', () => {
    const md = '---\ndescription: nameless\n---\nBody.\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });

  test('empty name throws SkillParseError', () => {
    const md = '---\nname: "   "\ndescription: blank name\n---\nBody.\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });

  test('invalid YAML in fence throws SkillParseError', () => {
    const md = '---\nname: [unterminated\n---\nBody.\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });

  test('invalid name (uppercase) via parseSkillMd throws', () => {
    const md = '---\nname: MySkill\n---\nBody.\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });

  test('invalid name (spaces) via parseSkillMd throws', () => {
    const md = '---\nname: my skill\n---\nBody.\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });

  test('invalid name (leading hyphen) via parseSkillMd throws', () => {
    const md = '---\nname: -leading\n---\nBody.\n';
    expect(() => parseSkillMd(enc(md))).toThrow(SkillParseError);
  });
});

describe('validateSkillName', () => {
  test('accepts a valid kebab-case name', () => {
    expect(() => validateSkillName('my-skill-123')).not.toThrow();
  });

  test('accepts a single segment name', () => {
    expect(() => validateSkillName('skill')).not.toThrow();
  });

  test('rejects uppercase', () => {
    expect(() => validateSkillName('MySkill')).toThrow(SkillParseError);
  });

  test('rejects spaces', () => {
    expect(() => validateSkillName('my skill')).toThrow(SkillParseError);
  });

  test('rejects leading hyphen', () => {
    expect(() => validateSkillName('-leading')).toThrow(SkillParseError);
  });

  test('rejects trailing hyphen', () => {
    expect(() => validateSkillName('trailing-')).toThrow(SkillParseError);
  });

  test('rejects double hyphen', () => {
    expect(() => validateSkillName('a--b')).toThrow(SkillParseError);
  });

  test('rejects name longer than 64 chars', () => {
    const long = 'a'.repeat(65);
    expect(() => validateSkillName(long)).toThrow(SkillParseError);
  });

  test('accepts a name of exactly 64 chars', () => {
    const exact = 'a'.repeat(64);
    expect(() => validateSkillName(exact)).not.toThrow();
  });
});
