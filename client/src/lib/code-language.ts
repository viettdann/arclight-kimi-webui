import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { type Language, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { csharp, kotlin, scala } from '@codemirror/legacy-modes/mode/clike';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { hcl } from 'codemirror-lang-hcl';

// A resolved CodeMirror language: either a full `LanguageSupport` (lang-*
// packages) or a bare `Language` (StreamLanguage legacy modes). Both are valid
// editor `Extension`s and both expose a Lezer parser for static highlighting.
export type CodeLanguage = LanguageSupport | Language;

const stream = (parser: Parameters<typeof StreamLanguage.define>[0]): StreamLanguage<unknown> =>
  StreamLanguage.define(parser);

// Each grammar factory (`javascript()`, `stream(shell)`, …) builds a fresh
// language + parser, so resolved instances are memoized per token — the set of
// tokens is small and fixed, keeping this naturally bounded.
const tokenLanguages = new Map<string, CodeLanguage | null>();

/**
 * Resolve a language token — a file extension or a markdown fence id
 * (lowercased, no leading dot) — to a CodeMirror language. `null` = no grammar
 * (plain text). The resolved language is cached and reused across calls.
 */
export function languageForToken(token: string): CodeLanguage | null {
  const cached = tokenLanguages.get(token);
  if (cached !== undefined) return cached;
  const lang = buildLanguageForToken(token);
  tokenLanguages.set(token, lang);
  return lang;
}

function buildLanguageForToken(token: string): CodeLanguage | null {
  switch (token) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'javascript':
    case 'node':
      return javascript();
    case 'ts':
    case 'mts':
    case 'cts':
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'html':
    case 'htm':
      return html();
    case 'css':
      return css();
    case 'json':
    case 'jsonc':
    case 'json5':
      return json();
    case 'md':
    case 'markdown':
      return markdown();
    case 'py':
    case 'pyi':
    case 'python':
      return python();
    case 'yml':
    case 'yaml':
      return yaml();
    case 'go':
    case 'golang':
      return go();
    case 'rs':
    case 'rust':
      return rust();
    case 'java':
      return java();
    case 'c':
    case 'h':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'hpp':
    case 'hh':
      return cpp();
    case 'php':
      return php();
    case 'sql':
      return sql();
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
      return xml();
    case 'tf':
    case 'tfvars':
    case 'hcl':
    case 'terraform':
      return hcl();
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ksh':
    case 'shell':
    case 'console':
      return stream(shell);
    case 'cs':
    case 'csx':
    case 'csharp':
      return stream(csharp);
    case 'kt':
    case 'kts':
    case 'kotlin':
      return stream(kotlin);
    case 'scala':
    case 'sc':
      return stream(scala);
    case 'rb':
    case 'ruby':
      return stream(ruby);
    case 'swift':
      return stream(swift);
    case 'lua':
      return stream(lua);
    case 'clj':
    case 'cljs':
    case 'cljc':
    case 'edn':
    case 'clojure':
      return stream(clojure);
    case 'ps1':
    case 'psm1':
    case 'psd1':
    case 'powershell':
    case 'pwsh':
      return stream(powerShell);
    case 'toml':
      return stream(toml);
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'properties':
    case 'editorconfig':
      return stream(properties);
    case 'dockerfile':
    case 'docker':
      return stream(dockerFile);
    case 'nginx':
      return stream(nginx);
    default:
      return null;
  }
}

/**
 * Resolve a filename (with optional path) to a language, honoring basenames
 * that carry no useful extension (Dockerfile, .env, nginx.conf). `null` = plain
 * text.
 */
export function languageForFilename(name: string): CodeLanguage | null {
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
