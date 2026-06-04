import { describe, expect, it } from 'vitest';
import { basename, getFileIcon } from '@/lib/file-icons';

describe('basename', () => {
  it('returns empty string for empty path', () => {
    expect(basename('')).toBe('');
  });

  it('extracts the final segment of a posix path', () => {
    expect(basename('/src/lib/utils.ts')).toBe('utils.ts');
  });

  it('extracts the final segment of a windows path', () => {
    expect(basename('C:\\src\\components\\App.tsx')).toBe('App.tsx');
  });

  it('returns the input unchanged when there is no separator', () => {
    expect(basename('README.md')).toBe('README.md');
  });
});

describe('getFileIcon', () => {
  it('falls back to FILE for an empty path', () => {
    expect(getFileIcon('').label).toBe('FILE');
  });

  it('falls back for an unknown extension', () => {
    expect(getFileIcon('archive.unknownext').label).toBe('FILE');
  });

  it('falls back for a dotless, non-special basename', () => {
    expect(getFileIcon('somerandomname').label).toBe('FILE');
  });

  it('resolves by extension, ignoring directory and case', () => {
    expect(getFileIcon('/src/lib/utils.ts').label).toBe('TS');
    expect(getFileIcon('App.TSX').label).toBe('TSX');
    expect(getFileIcon('data.json').label).toBe('JSON');
  });

  it('honors the compound .d.ts extension before single-extension lookup', () => {
    expect(getFileIcon('types/global.d.ts').label).toBe('DTS');
    // A plain .ts is still TS, proving the .d.ts branch is specific.
    expect(getFileIcon('global.ts').label).toBe('TS');
  });

  it('matches special full basenames over their extension', () => {
    expect(getFileIcon('tsconfig.json').label).toBe('TSC');
    expect(getFileIcon('/repo/tsconfig.json').label).toBe('TSC');
    // tsconfig.json is special; a generic *.json stays JSON.
    expect(getFileIcon('other.json').label).toBe('JSON');
  });

  it('matches dotless special basenames', () => {
    expect(getFileIcon('Dockerfile').label).toBe('DOCK');
    expect(getFileIcon('Makefile').label).toBe('MAKE');
    expect(getFileIcon('LICENSE').label).toBe('LIC');
  });

  it('returns the shared FALLBACK reference (not a fresh object)', () => {
    expect(getFileIcon('')).toBe(getFileIcon('also-unknown'));
  });
});
