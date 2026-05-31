import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ContextUsagePayload } from 'shared/types';
import { useSessionChat } from '../../lib/chat-store';
import { sendWS } from '../../lib/ws-send';
import { Button } from '../ui/button';

interface ContextPanelProps {
  sessionId: string | undefined;
}

// Local category-name → color palette. Names mirror the SDK context categories;
// unknown names fall back to a neutral color.
const CATEGORY_COLORS: Record<string, string> = {
  'System prompt': '#64748b',
  'System tools': '#0ea5e9',
  'Custom agents': '#a855f7',
  'Memory files': '#f59e0b',
  Messages: '#22c55e',
  'Free space': '#3f3f46',
  'Autocompact buffer': '#ef4444',
  'MCP tools': '#ec4899',
};
const FALLBACK_COLOR = '#94a3b8';

function colorFor(name: string): string {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLOR;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ContextPanel({ sessionId }: ContextPanelProps) {
  const session = useSessionChat(sessionId);
  const contextUsage: ContextUsagePayload | null = session?.contextUsage ?? null;
  const isTurnInProgress = session?.isTurnInProgress ?? false;

  // Optimistic "compacting" flag: set on click, cleared when a turn ends or a
  // compaction completes (observed via the turn-in-progress flip or a fresh
  // contextUsage reference, which the server re-broadcasts after compaction).
  const [compacting, setCompacting] = useState(false);
  const usageRef = useRef(contextUsage);
  useEffect(() => {
    // A new contextUsage object (post-compaction re-fetch) clears the flag.
    if (usageRef.current !== contextUsage) {
      usageRef.current = contextUsage;
      setCompacting(false);
    }
  }, [contextUsage]);
  useEffect(() => {
    // Any observed turn end clears the optimistic flag too.
    if (!isTurnInProgress) setCompacting(false);
  }, [isTurnInProgress]);

  const onCompact = () => {
    if (!sessionId) return;
    setCompacting(true);
    sendWS('compact_session', {}, sessionId);
  };

  const compactDisabled = !sessionId || isTurnInProgress || contextUsage == null || compacting;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Context
        </h4>
        <span
          className="text-muted-foreground/60"
          title="Context-window usage broken down by category, loaded skills, and memory files. Compact summarizes older turns to free space."
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </div>

      {contextUsage == null ? (
        <p className="text-sm text-muted-foreground">Context unavailable</p>
      ) : (
        <>
          {/* Usage bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {Math.round(contextUsage.percentage)}% used
              </span>
              <span className="text-muted-foreground">
                {fmtTokens(contextUsage.totalTokens)} / {fmtTokens(contextUsage.maxTokens)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, contextUsage.percentage))}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">{contextUsage.model}</p>
          </div>

          {/* Category breakdown legend */}
          {contextUsage.categories.length > 0 && (
            <ul className="space-y-1.5">
              {contextUsage.categories.map((cat) => (
                <li key={cat.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: colorFor(cat.name) }}
                    />
                    <span className="truncate text-foreground">{cat.name}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{fmtTokens(cat.tokens)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Loaded skills */}
          {contextUsage.skills.length > 0 && (
            <div className="space-y-1.5">
              <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Skills
              </h5>
              <ul className="space-y-1">
                {contextUsage.skills.map((skill) => (
                  <li
                    key={`${skill.source}:${skill.name}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-foreground">{skill.name}</span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {skill.source}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {fmtTokens(skill.tokens)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Memory files */}
          {contextUsage.memoryFiles.length > 0 && (
            <div className="space-y-1.5">
              <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Memory files
              </h5>
              <ul className="space-y-1">
                {contextUsage.memoryFiles.map((file) => (
                  <li key={file.path} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-foreground">{file.path}</span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {file.type}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">{fmtTokens(file.tokens)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onCompact}
        disabled={compactDisabled}
      >
        {compacting ? 'Compacting…' : 'Compact'}
      </Button>
    </div>
  );
}
