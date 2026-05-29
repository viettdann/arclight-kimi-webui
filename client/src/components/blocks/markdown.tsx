import yaml from 'js-yaml';
import { Check, Copy, FileCode } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';

/**
 * True while the surrounding markdown is still streaming in. Code blocks defer
 * highlighting until the block is complete — re-parsing a block that grows on
 * every token is wasted work.
 */
export const MarkdownStreamingContext = createContext(false);

// Lazy-loaded highlighter, shared across all code blocks so the Lezer grammars
// stay out of the initial bundle and load exactly once.
type HighlightModule = typeof import('@/lib/highlight-code');
let highlightModule: HighlightModule | null = null;
let highlightModulePromise: Promise<HighlightModule> | null = null;
function loadHighlightModule(): Promise<HighlightModule> {
  highlightModulePromise ??= import('@/lib/highlight-code').then((m) => {
    highlightModule = m;
    return m;
  });
  return highlightModulePromise;
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const streaming = useContext(MarkdownStreamingContext);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(resetTimer.current ?? undefined), []);

  // Load grammars once the block is settled (not streaming). The block renders
  // plain until the chunk resolves, then upgrades to highlighted markup.
  const [ready, setReady] = useState(highlightModule != null);
  useEffect(() => {
    if (streaming) return;
    if (highlightModule != null) {
      setReady(true);
      return;
    }
    let alive = true;
    loadHighlightModule().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [streaming]);

  const html = useMemo(
    () =>
      ready && !streaming && highlightModule
        ? highlightModule.highlightToHtml(code, language)
        : null,
    [ready, streaming, code, language],
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    clearTimeout(resetTimer.current ?? undefined);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-xl border border-border bg-card/60 overflow-hidden shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between bg-muted/30 px-4 py-2 border-b border-border/80 text-xs font-mono">
        <div className="flex items-center gap-2 text-foreground/70">
          <FileCode className="h-4 w-4 text-primary" />
          <span>{language || 'code'}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="p-4 font-mono text-xs overflow-x-auto leading-relaxed select-text bg-muted/5 max-h-[30rem] scrollbar-thin">
        <pre className="code-hl whitespace-pre-wrap break-words">
          {html == null ? (
            code
          ) : (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: token spans are HTML-escaped in highlightToHtml
            <code dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </pre>
      </div>
    </div>
  );
}

// Shared `react-markdown` component overrides: GFM tables, headings, code
// fences, etc. Reused by the chat transcript and the file-editor preview.
export const markdownComponents: Components = {
  h1: ({ children, ...rest }) => (
    <h1 {...rest} className="text-2xl font-bold tracking-tight mt-6 mb-3 text-foreground font-sans">
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2
      {...rest}
      className="relative text-xl font-semibold mt-5 mb-2.5 text-foreground font-sans border-b-2 border-[var(--accent-wash)] pb-2 after:absolute after:left-0 after:-bottom-[2px] after:h-[2px] after:w-11 after:rounded-full after:bg-primary after:content-['']"
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3 {...rest} className="text-lg font-semibold mt-4 mb-2 text-primary font-sans">
      {children}
    </h3>
  ),
  h4: ({ children, ...rest }) => (
    <h4 {...rest} className="text-base font-semibold mt-3 mb-1.5 text-foreground font-sans">
      {children}
    </h4>
  ),
  h5: ({ children, ...rest }) => (
    <h5
      {...rest}
      className="text-sm font-semibold mt-3 mb-1.5 text-foreground/90 font-sans uppercase tracking-wide"
    >
      {children}
    </h5>
  ),
  h6: ({ children, ...rest }) => (
    <h6
      {...rest}
      className="text-xs font-semibold mt-3 mb-1.5 text-muted-foreground font-sans uppercase tracking-wider"
    >
      {children}
    </h6>
  ),
  p: ({ children, ...rest }) => (
    <p
      {...rest}
      className="my-3 text-sm text-foreground/90 leading-relaxed font-sans select-text break-words"
    >
      {children}
    </p>
  ),
  a: ({ children, href, ...rest }) => (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:text-primary/80 hover:bg-[var(--accent-wash)] rounded-sm break-all transition-colors"
    >
      {children}
    </a>
  ),
  ul: ({ children, ...rest }) => (
    <ul
      {...rest}
      className="list-disc marker:text-primary pl-6 space-y-1.5 my-3 text-sm text-foreground/90 font-sans leading-relaxed"
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...rest }) => (
    <ol
      {...rest}
      className="list-decimal marker:font-semibold marker:text-primary pl-6 space-y-1.5 my-3 text-sm text-foreground/90 font-sans leading-relaxed"
    >
      {children}
    </ol>
  ),
  li: ({ children, ...rest }) => (
    <li {...rest} className="leading-relaxed">
      {children}
    </li>
  ),
  blockquote: ({ children, ...rest }) => (
    <blockquote
      {...rest}
      className="border-l-4 border-primary pl-4 py-2 my-4 text-foreground/90 bg-[var(--quote-bg)] rounded-r-lg [&_strong]:text-primary"
    >
      {children}
    </blockquote>
  ),
  hr: ({ ...rest }) => <hr {...rest} className="my-6 border-t border-border/60" />,
  table: ({ children, ...rest }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border/60">
      <table {...rest} className="w-full text-sm font-sans border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...rest }) => (
    <thead {...rest} className="bg-[var(--accent-wash)] text-foreground">
      {children}
    </thead>
  ),
  th: ({ children, ...rest }) => (
    <th {...rest} className="px-3 py-2 text-left font-semibold border-b-2 border-primary/30">
      {children}
    </th>
  ),
  td: ({ children, ...rest }) => (
    <td {...rest} className="px-3 py-2 border-b border-border/30 align-top">
      {children}
    </td>
  ),
  strong: ({ children, ...rest }) => (
    <strong {...rest} className="font-bold text-foreground">
      {children}
    </strong>
  ),
  em: ({ children, ...rest }) => (
    <em {...rest} className="italic">
      {children}
    </em>
  ),
  code: ({ children, className, ...rest }) => {
    const match = /language-(\w+)/.exec(className || '');
    const text = String(children ?? '').replace(/\n$/, '');
    // Inline code — no language fence and no newline.
    if (!match && !text.includes('\n')) {
      return (
        <code
          {...rest}
          className="font-mono text-xs bg-muted border border-border px-1.5 py-0.5 rounded text-primary break-words"
        >
          {children}
        </code>
      );
    }
    return <CodeBlock code={text} language={match?.[1] ?? ''} />;
  },
  pre: ({ children }) => <>{children}</>,
};

// ─────────────────────────── YAML frontmatter ───────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a leading `--- ... ---` YAML frontmatter block off the document.
 * Returns the parsed object (when valid) plus the remaining markdown body.
 */
export function splitFrontmatter(src: string): {
  data: Record<string, unknown> | null;
  body: string;
} {
  const m = FRONTMATTER_RE.exec(src);
  if (m == null) return { data: null, body: src };
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = yaml.load(m[1] ?? '');
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — leave the block in the body so the user still sees it.
    return { data: null, body: src };
  }
  return { data, body: src.slice(m[0].length) };
}

function renderValue(v: unknown) {
  if (Array.isArray(v)) {
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((item, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: frontmatter list items are positional and static
            key={i}
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80"
          >
            {String(item)}
          </span>
        ))}
      </span>
    );
  }
  if (v != null && typeof v === 'object') {
    return <span className="font-mono text-xs">{JSON.stringify(v)}</span>;
  }
  return <span className="text-foreground/90">{String(v)}</span>;
}

/** Renders parsed YAML frontmatter as a compact key/value metadata table. */
export function FrontmatterTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border/60 bg-muted/10">
      <table className="w-full border-collapse text-sm font-sans">
        <tbody>
          {entries.map(([key, val]) => (
            <tr key={key} className="border-b border-border/30 last:border-b-0">
              <th className="w-px whitespace-nowrap px-3 py-1.5 text-left align-top font-medium text-muted-foreground">
                {key}
              </th>
              <td className="px-3 py-1.5 align-top">{renderValue(val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
