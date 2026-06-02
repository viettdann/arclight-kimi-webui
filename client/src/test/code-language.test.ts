import { describe, it, expect } from 'vitest';
import { LanguageSupport } from '@codemirror/language';
import { languageForToken, languageForFilename, parserFor } from '@/lib/code-language';

describe('languageForToken', () => {
  it('resolves a known lang-* token to a CodeMirror language', async () => {
    const lang = await languageForToken('ts');
    expect(lang).toBeInstanceOf(LanguageSupport);
  });

  it('resolves a known legacy-mode (StreamLanguage) token', async () => {
    const lang = await languageForToken('toml');
    expect(lang).not.toBeNull();
    // StreamLanguage is a bare Language, not a LanguageSupport.
    expect(lang).not.toBeInstanceOf(LanguageSupport);
  });

  it('resolves to null for a token with no grammar', async () => {
    expect(await languageForToken('definitely-not-a-language')).toBeNull();
  });

  it('treats aliases as the same language family', async () => {
    expect(await languageForToken('js')).toBeInstanceOf(LanguageSupport);
    expect(await languageForToken('node')).toBeInstanceOf(LanguageSupport);
  });

  it('memoizes — repeated calls return the identical resolved instance', async () => {
    const a = await languageForToken('python');
    const b = await languageForToken('python');
    expect(a).toBe(b);
  });
});

describe('languageForFilename', () => {
  it('resolves by extension', async () => {
    expect(await languageForFilename('/src/App.tsx')).toBeInstanceOf(LanguageSupport);
  });

  it('honors extensionless special basenames', async () => {
    expect(await languageForFilename('Dockerfile')).not.toBeNull();
    expect(await languageForFilename('.env')).not.toBeNull();
    expect(await languageForFilename('.env.production')).not.toBeNull();
    expect(await languageForFilename('nginx.conf')).not.toBeNull();
  });

  it('resolves to null for a plain-text filename', async () => {
    expect(await languageForFilename('notes.unknownext')).toBeNull();
    expect(await languageForFilename('LICENSE')).toBeNull();
  });
});

describe('parserFor', () => {
  it('extracts a usable Lezer parser from a resolved language', async () => {
    const lang = await languageForToken('json');
    expect(lang).not.toBeNull();
    const parser = parserFor(lang!);
    expect(parser).toBeDefined();
    expect(typeof parser.parse).toBe('function');
  });
});
