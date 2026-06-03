import { highlightCode, tags as t, tagHighlighter } from '@lezer/highlight';
import { type CodeLanguage, languageForToken, parserFor } from './code-language';

// Map Lezer highlight tags onto the theme's syntax-token classes (`.tok-*`),
// styled in index.css. The same Lezer grammars power the file editor, so code
// blocks and the editor tokenize identically.
const highlighter = tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-com' },
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.modifier,
      t.self,
      t.null,
      t.tagName,
    ],
    class: 'tok-kw',
  },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'tok-fn' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], class: 'tok-type' },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape, t.attributeValue],
    class: 'tok-str',
  },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom], class: 'tok-num' },
  { tag: [t.variableName, t.propertyName, t.attributeName, t.labelName], class: 'tok-var' },
]);

// Beyond this, parsing cost outweighs the benefit — render plain.
const MAX_LEN = 50_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/**
 * Tokenize `code` for the given markdown fence language and return HTML with
 * `.tok-*` spans. The grammar is loaded on demand (one chunk per language).
 * Falls back to escaped plain text when the language is unknown, the input is
 * oversized, or parsing fails. Never rejects.
 */
export async function highlightToHtml(code: string, langToken: string): Promise<string> {
  const lang: CodeLanguage | null =
    langToken.length > 0 ? await languageForToken(langToken.toLowerCase()) : null;
  if (lang == null || code.length > MAX_LEN) return escapeHtml(code);
  try {
    const tree = parserFor(lang).parse(code);
    let html = '';
    highlightCode(
      code,
      tree,
      highlighter,
      (text, cls) => {
        html += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
      },
      () => {
        html += '\n';
      },
    );
    return html;
  } catch {
    return escapeHtml(code);
  }
}
