import { type Language, LanguageSupport, StreamLanguage } from '@codemirror/language';

// A resolved CodeMirror language: either a full `LanguageSupport` (lang-*
// packages) or a bare `Language` (StreamLanguage legacy modes). Both are valid
// editor `Extension`s and both expose a Lezer parser for static highlighting.
export type CodeLanguage = LanguageSupport | Language;

// Each grammar lives in its own dynamically-imported chunk so a token only
// pulls the bytes for the one language in use — not every grammar. The core
// `@codemirror/language` runtime (StreamLanguage, LanguageSupport) stays in the
// main bundle; only the per-language parsers are split out.
type Loader = () => Promise<CodeLanguage>;

const stream = (parser: Parameters<typeof StreamLanguage.define>[0]): StreamLanguage<unknown> =>
  StreamLanguage.define(parser);

// Memoize the in-flight (and resolved) load per token so concurrent callers
// share one chunk fetch. The set of tokens is small and fixed, keeping this
// naturally bounded.
const tokenLanguages = new Map<string, Promise<CodeLanguage | null>>();

/**
 * Resolve a language token — a file extension or a markdown fence id
 * (lowercased, no leading dot) — to a CodeMirror language. Resolves to `null`
 * for tokens with no grammar (plain text). The load is cached and reused across
 * calls; a failed load is evicted so a later call can retry, and degrades to
 * plain text rather than rejecting.
 */
export function languageForToken(token: string): Promise<CodeLanguage | null> {
  const cached = tokenLanguages.get(token);
  if (cached !== undefined) return cached;
  const loader = loaderForToken(token);
  if (loader == null) {
    const nil = Promise.resolve(null);
    tokenLanguages.set(token, nil);
    return nil;
  }
  const promise = loader().catch((err: unknown) => {
    // Chunk failed to load (e.g. a stale hash mid-deploy). Evict so a later
    // call can retry, and fall back to plain text for this one.
    tokenLanguages.delete(token);
    console.error(`Failed to load grammar for "${token}":`, err);
    return null;
  });
  tokenLanguages.set(token, promise);
  return promise;
}

function loaderForToken(token: string): Loader | null {
  switch (token) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'javascript':
    case 'node':
      return () => import('@codemirror/lang-javascript').then((m) => m.javascript());
    case 'ts':
    case 'mts':
    case 'cts':
    case 'typescript':
      return () =>
        import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true }));
    case 'tsx':
      return () =>
        import('@codemirror/lang-javascript').then((m) =>
          m.javascript({ typescript: true, jsx: true }),
        );
    case 'html':
    case 'htm':
      return () => import('@codemirror/lang-html').then((m) => m.html());
    case 'css':
      return () => import('@codemirror/lang-css').then((m) => m.css());
    case 'json':
    case 'jsonc':
    case 'json5':
      return () => import('@codemirror/lang-json').then((m) => m.json());
    case 'md':
    case 'markdown':
      return () => import('@codemirror/lang-markdown').then((m) => m.markdown());
    case 'py':
    case 'pyi':
    case 'python':
      return () => import('@codemirror/lang-python').then((m) => m.python());
    case 'yml':
    case 'yaml':
      return () => import('@codemirror/lang-yaml').then((m) => m.yaml());
    case 'go':
    case 'golang':
      return () => import('@codemirror/lang-go').then((m) => m.go());
    case 'rs':
    case 'rust':
      return () => import('@codemirror/lang-rust').then((m) => m.rust());
    case 'java':
      return () => import('@codemirror/lang-java').then((m) => m.java());
    case 'c':
    case 'h':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'hpp':
    case 'hh':
      return () => import('@codemirror/lang-cpp').then((m) => m.cpp());
    case 'php':
      return () => import('@codemirror/lang-php').then((m) => m.php());
    case 'sql':
      return () => import('@codemirror/lang-sql').then((m) => m.sql());
    case 'xml':
    case 'svg':
    case 'xsd':
    case 'xsl':
    case 'plist':
    case 'csproj':
    case 'vbproj':
    case 'props':
    case 'targets':
    case 'slnx': // new XML-based VS solution format (.sln is not XML → plain text)
      return () => import('@codemirror/lang-xml').then((m) => m.xml());
    case 'tf':
    case 'tfvars':
    case 'hcl':
    case 'terraform':
      return () => import('codemirror-lang-hcl').then((m) => m.hcl());
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ksh':
    case 'shell':
    case 'console':
      return () => import('@codemirror/legacy-modes/mode/shell').then((m) => stream(m.shell));
    case 'cs':
    case 'csx':
    case 'csharp':
      return () => import('@codemirror/legacy-modes/mode/clike').then((m) => stream(m.csharp));
    case 'kt':
    case 'kts':
    case 'kotlin':
      return () => import('@codemirror/legacy-modes/mode/clike').then((m) => stream(m.kotlin));
    case 'scala':
    case 'sc':
      return () => import('@codemirror/legacy-modes/mode/clike').then((m) => stream(m.scala));
    case 'rb':
    case 'ruby':
      return () => import('@codemirror/legacy-modes/mode/ruby').then((m) => stream(m.ruby));
    case 'swift':
      return () => import('@codemirror/legacy-modes/mode/swift').then((m) => stream(m.swift));
    case 'lua':
      return () => import('@codemirror/legacy-modes/mode/lua').then((m) => stream(m.lua));
    case 'clj':
    case 'cljs':
    case 'cljc':
    case 'edn':
    case 'clojure':
      return () => import('@codemirror/legacy-modes/mode/clojure').then((m) => stream(m.clojure));
    case 'ps1':
    case 'psm1':
    case 'psd1':
    case 'powershell':
    case 'pwsh':
      return () =>
        import('@codemirror/legacy-modes/mode/powershell').then((m) => stream(m.powerShell));
    case 'toml':
      return () => import('@codemirror/legacy-modes/mode/toml').then((m) => stream(m.toml));
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'properties':
    case 'editorconfig':
      return () =>
        import('@codemirror/legacy-modes/mode/properties').then((m) => stream(m.properties));
    case 'dockerfile':
    case 'docker':
      return () =>
        import('@codemirror/legacy-modes/mode/dockerfile').then((m) => stream(m.dockerFile));
    case 'nginx':
      return () => import('@codemirror/legacy-modes/mode/nginx').then((m) => stream(m.nginx));
    default:
      return null;
  }
}

/**
 * Resolve a filename (with optional path) to a language, honoring basenames
 * that carry no useful extension (Dockerfile, .env, nginx.conf). Resolves to
 * `null` for plain text.
 */
export function languageForFilename(name: string): Promise<CodeLanguage | null> {
  const lc = name.toLowerCase();
  if (lc === 'dockerfile' || lc.endsWith('.dockerfile')) return languageForToken('dockerfile');
  if (lc === '.env' || lc.startsWith('.env.')) return languageForToken('properties');
  if (lc === 'nginx.conf' || lc.endsWith('.nginx')) return languageForToken('nginx');
  const dot = lc.lastIndexOf('.');
  const ext = dot < 0 ? '' : lc.slice(dot + 1);
  return languageForToken(ext);
}

/** Extract the Lezer parser from a resolved language, for static highlighting. */
export function parserFor(lang: CodeLanguage) {
  const language = lang instanceof LanguageSupport ? lang.language : lang;
  return language.parser;
}
