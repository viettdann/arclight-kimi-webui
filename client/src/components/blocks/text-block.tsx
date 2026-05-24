import { Check, Copy, FileCode, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface TextBlockProps {
  content: string;
  isStreaming?: boolean;
}

// Sleek and beautiful built-in CodeBlock component for markdown code chunks
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
        <pre>{code}</pre>
      </div>
    </div>
  );
}

export function TextBlock({ content, isStreaming }: TextBlockProps) {
  // Parse simple markdown block elements
  const parseMarkdown = (text: string) => {
    if (!text) return [];

    const elements: React.ReactNode[] = [];
    const parts = text.split(/(```[\s\S]*?```)/g);

    parts.forEach((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        // Code Block
        const lines = part.slice(3, -3).split('\n');
        const firstLine = lines[0]?.trim() || '';
        const language = /^[a-zA-Z0-9+#-]+$/.test(firstLine) ? firstLine : '';
        const code = (language ? lines.slice(1) : lines).join('\n').trim();
        elements.push(<CodeBlock key={`code-${index}`} code={code} language={language} />);
      } else {
        // Normal text block
        const paragraphs = part.split(/\n\n+/);
        paragraphs.forEach((p, pIdx) => {
          const trimmed = p.trim();
          if (!trimmed) return;

          // Headings
          if (trimmed.startsWith('# ')) {
            elements.push(
              <h1
                key={`h1-${index}-${pIdx}`}
                className="text-2xl font-bold tracking-tight mt-6 mb-3 text-foreground font-sans"
              >
                {renderInlineMarkdown(trimmed.slice(2))}
              </h1>,
            );
          } else if (trimmed.startsWith('## ')) {
            elements.push(
              <h2
                key={`h2-${index}-${pIdx}`}
                className="text-xl font-semibold mt-5 mb-2.5 text-foreground font-sans border-b border-border/40 pb-1"
              >
                {renderInlineMarkdown(trimmed.slice(3))}
              </h2>,
            );
          } else if (trimmed.startsWith('### ')) {
            elements.push(
              <h3
                key={`h3-${index}-${pIdx}`}
                className="text-lg font-semibold mt-4 mb-2 text-foreground font-sans"
              >
                {renderInlineMarkdown(trimmed.slice(4))}
              </h3>,
            );
          }
          // Bullet lists
          else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const items = trimmed.split(/\n[-*]\s+/).map((line) => {
              // Strip initial indicator if present
              if (line.startsWith('- ') || line.startsWith('* ')) {
                return line.slice(2);
              }
              return line;
            });
            elements.push(
              <ul
                key={`ul-${index}-${pIdx}`}
                className="list-disc pl-6 space-y-1.5 my-3 text-foreground/90 font-sans leading-relaxed"
              >
                {items.map((item, itemIdx) => (
                  <li key={itemIdx}>{renderInlineMarkdown(item)}</li>
                ))}
              </ul>,
            );
          }
          // Numbered lists
          else if (/^\d+\.\s+/.test(trimmed)) {
            const items = trimmed.split(/\n\d+\.\s+/).map((line) => {
              const match = line.match(/^\d+\.\s+(.*)/);
              return match ? match[1]! : line;
            });
            elements.push(
              <ol
                key={`ol-${index}-${pIdx}`}
                className="list-decimal pl-6 space-y-1.5 my-3 text-foreground/90 font-sans leading-relaxed"
              >
                {items.map((item, itemIdx) => (
                  <li key={itemIdx}>{renderInlineMarkdown(item)}</li>
                ))}
              </ol>,
            );
          }
          // Standard Paragraph
          else {
            // Handle block quotes
            if (trimmed.startsWith('> ')) {
              elements.push(
                <blockquote
                  key={`bq-${index}-${pIdx}`}
                  className="border-l-4 border-primary/50 pl-4 py-1.5 my-4 italic text-muted-foreground bg-muted/10 rounded-r-md"
                >
                  {renderInlineMarkdown(trimmed.slice(2))}
                </blockquote>,
              );
            } else {
              elements.push(
                <p
                  key={`p-${index}-${pIdx}`}
                  className="my-3 text-sm text-foreground/90 leading-relaxed font-sans select-text break-words"
                >
                  {renderInlineMarkdown(trimmed)}
                </p>,
              );
            }
          }
        });
      }
    });

    return elements;
  };

  // Parse bold, italic, and inline code formatting inside lines
  const renderInlineMarkdown = (text: string): React.ReactNode[] => {
    if (!text) return [];

    const elements: React.ReactNode[] = [];
    // Match inline code, bold, italic
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
    const parts = text.split(regex);

    parts.forEach((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        elements.push(
          <strong key={idx} className="font-bold text-foreground">
            {part.slice(2, -2)}
          </strong>,
        );
      } else if (part.startsWith('*') && part.endsWith('*')) {
        elements.push(
          <em key={idx} className="italic">
            {part.slice(1, -1)}
          </em>,
        );
      } else if (part.startsWith('`') && part.endsWith('`')) {
        elements.push(
          <code
            key={idx}
            className="font-mono text-xs bg-muted border border-border px-1.5 py-0.5 rounded text-primary"
          >
            {part.slice(1, -1)}
          </code>,
        );
      } else {
        elements.push(part);
      }
    });

    return elements;
  };

  return (
    <div className="flex flex-col gap-1 w-full prose dark:prose-invert max-w-none">
      <div className="space-y-1 select-text">
        {parseMarkdown(content)}
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
