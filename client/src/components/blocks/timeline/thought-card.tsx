import { ChevronDown, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ThoughtCardProps {
  content: string;
  encrypted?: boolean;
  /** Reserved for callers; behavior no longer differs by streaming state. */
  isStreaming?: boolean;
  /** Max collapsed height in px before fade-out + expand affordance. */
  collapsedMaxHeight?: number;
}

/**
 * Render thinking content as a soft card with markdown.
 * Always starts collapsed (consistent across all rows — no streaming-driven
 * state changes that would visually "jump"). User opens with the chevron.
 */
export function ThoughtCard({ content, encrypted, collapsedMaxHeight = 220 }: ThoughtCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  // Detect content overflow against the collapsed cap. `content` is a real
  // dep — it mutates DOM, which changes `innerRef.current.scrollHeight`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content drives DOM size
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > collapsedMaxHeight + 8);
  }, [content, collapsedMaxHeight]);

  const showFade = !expanded && overflowing;
  const maxHeight = expanded ? undefined : `${collapsedMaxHeight}px`;

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3.5 py-2.5 text-xs leading-relaxed">
      {encrypted && (
        <div className="mb-1.5 inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-mono font-medium">
          <Lock className="h-2.5 w-2.5" />
          <span>Encrypted</span>
        </div>
      )}
      <div
        className="relative overflow-hidden text-muted-foreground/95 select-text break-words"
        style={{ maxHeight }}
      >
        <div ref={innerRef} className="thought-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ' '}</ReactMarkdown>
        </div>
        {showFade && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted/40 to-transparent" />
        )}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 w-full flex justify-center text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
          aria-label={expanded ? 'Collapse thought' : 'Expand thought'}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </div>
  );
}
