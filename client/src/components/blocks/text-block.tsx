import { Check, Copy, FileCode, Loader2 } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseHarnessTags } from '../../lib/harness-tags';
import { HarnessTagBlock } from './harness-tag-block';

interface TextBlockProps {
  content: string;
  isStreaming?: boolean;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <pre className="whitespace-pre-wrap break-words">{code}</pre>
      </div>
    </div>
  );
}

const components: Components = {
  h1: ({ children, ...rest }) => (
    <h1 {...rest} className="text-2xl font-bold tracking-tight mt-6 mb-3 text-foreground font-sans">
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2
      {...rest}
      className="text-xl font-semibold mt-5 mb-2.5 text-foreground font-sans border-b border-border/40 pb-1"
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3 {...rest} className="text-lg font-semibold mt-4 mb-2 text-foreground font-sans">
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
      className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
    >
      {children}
    </a>
  ),
  ul: ({ children, ...rest }) => (
    <ul
      {...rest}
      className="list-disc pl-6 space-y-1.5 my-3 text-sm text-foreground/90 font-sans leading-relaxed"
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...rest }) => (
    <ol
      {...rest}
      className="list-decimal pl-6 space-y-1.5 my-3 text-sm text-foreground/90 font-sans leading-relaxed"
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
      className="border-l-4 border-primary/50 pl-4 py-1.5 my-4 italic text-muted-foreground bg-muted/10 rounded-r-md"
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
    <thead {...rest} className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
      {children}
    </thead>
  ),
  th: ({ children, ...rest }) => (
    <th {...rest} className="px-3 py-2 text-left font-semibold border-b border-border/60">
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

export function TextBlock({ content, isStreaming }: TextBlockProps) {
  const segments = parseHarnessTags(content);
  const hasTags = segments.some((s) => s.kind === 'tag');

  return (
    <div className="flex flex-col gap-2 w-full max-w-none">
      <div className="space-y-2 select-text">
        {hasTags ? (
          segments.map((seg, i) =>
            seg.kind === 'tag' ? (
              <HarnessTagBlock key={i} name={seg.name} content={seg.content} />
            ) : (
              seg.content.trim() && (
                <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
                  {seg.content}
                </ReactMarkdown>
              )
            ),
          )
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        )}
        {isStreaming && (
          <span className="inline-flex items-center gap-1.5 ml-1 text-primary select-none font-medium text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="animate-pulse">Assistant typing...</span>
          </span>
        )}
      </div>
    </div>
  );
}
