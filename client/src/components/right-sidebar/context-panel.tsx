import { BookText, FileText, Info, MessageSquare, Settings2 } from 'lucide-react';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import type { ContextUsagePayload } from 'shared/types';
import { useSessionChat } from '../../lib/chat-store';
import { fmtTokens } from '../../lib/utils';
import { sendWS } from '../../lib/ws-send';

interface ContextPanelProps {
  sessionId: string | undefined;
}

// Compact a memory-file path to its last two segments (parent/file) so two
// same-named files (e.g. project vs user CLAUDE.md) stay distinguishable.
function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

// The four coarse buckets the detailed payload folds into. `key` doubles as the
// expand toggle id; `color` drives both the segmented bar and the chip dot.
type GroupKey = 'messages' | 'skills' | 'files' | 'system';
// Data-viz palette for the segmented context bar — distinct hues per bucket,
// intentionally not theme tokens.
const GROUP_META: {
  key: GroupKey;
  label: string;
  color: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: 'messages', label: 'Messages', color: '#22c55e', Icon: MessageSquare },
  { key: 'skills', label: 'Skills', color: '#2563eb', Icon: BookText },
  { key: 'files', label: 'Files', color: '#38bdf8', Icon: FileText },
  { key: 'system', label: 'System', color: '#94a3b8', Icon: Settings2 },
];

interface GroupRow {
  label: string;
  sub?: string;
  tokens: number;
  Icon?: ComponentType<{ className?: string }>;
}

interface GroupData {
  tokens: number;
  loaded: GroupRow[];
  deferred: GroupRow[];
}

function emptyGroups(): Record<GroupKey, GroupData> {
  return {
    messages: { tokens: 0, loaded: [], deferred: [] },
    skills: { tokens: 0, loaded: [], deferred: [] },
    files: { tokens: 0, loaded: [], deferred: [] },
    system: { tokens: 0, loaded: [], deferred: [] },
  };
}

// Fold the SDK breakdown into the four buckets, splitting each into loaded vs
// deferred (shown-but-not-in-prompt). Only tools carry a defer flag; memory
// files and skill frontmatter are always loaded.
function buildGroups(usage: ContextUsagePayload): Record<GroupKey, GroupData> {
  const g = emptyGroups();

  // Messages / Memory / System come from the named categories. 'Messages' is
  // its own bucket; the 'Skills' aggregate is rebuilt from skillFrontmatter
  // below (so built-in listing entries can be filtered out); everything else
  // that isn't Skills/Memory falls to System.
  for (const c of usage.categories) {
    const row: GroupRow = { label: c.name, tokens: c.tokens };
    if (c.name === 'Messages') {
      g.messages.tokens += c.tokens;
      (c.isDeferred ? g.messages.deferred : g.messages.loaded).push(row);
    } else if (c.name === 'Skills') {
      // Skip — Skills tokens are recomputed from the filtered frontmatter.
    } else if (c.name === 'Memory files') {
      g.files.tokens += c.tokens;
    } else {
      g.system.tokens += c.tokens;
      (c.isDeferred ? g.system.deferred : g.system.loaded).push(row);
    }
  }

  // Skills: the frontmatter list is just the always-present skill *listing*, not
  // skill bodies loaded into the prompt. The built-in skills are the default
  // catalogue, so hide them — surface only user/project/plugin skills, which
  // are the ones actually brought into this session's context.
  for (const s of usage.skills) {
    if (s.source === 'built-in') continue;
    g.skills.tokens += s.tokens;
    g.skills.loaded.push({ label: s.name, sub: s.source, tokens: s.tokens, Icon: BookText });
  }

  // Memory files: both project + user CLAUDE.md often share the same basename,
  // so label with the parent dir to disambiguate (e.g. `~/.claude/CLAUDE.md`).
  for (const f of usage.memoryFiles) {
    g.files.loaded.push({
      label: shortPath(f.path),
      sub: f.type,
      tokens: f.tokens,
      Icon: FileText,
    });
  }
  if (g.files.tokens === 0) {
    g.files.tokens = usage.memoryFiles.reduce((sum, f) => sum + f.tokens, 0);
  }

  // System tools always loaded; MCP + deferred builtin tools split by isLoaded.
  for (const t of usage.systemTools) {
    g.system.loaded.push({ label: t.name, sub: 'system', tokens: t.tokens });
  }
  for (const t of usage.mcpTools) {
    const row: GroupRow = { label: t.name, sub: t.serverName, tokens: t.tokens };
    (t.isLoaded === false ? g.system.deferred : g.system.loaded).push(row);
  }
  for (const t of usage.deferredBuiltinTools) {
    const row: GroupRow = { label: t.name, sub: 'builtin', tokens: t.tokens };
    (t.isLoaded ? g.system.loaded : g.system.deferred).push(row);
  }

  return g;
}

function GroupRowItem({ row }: { row: GroupRow }) {
  const Icon = row.Icon;
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-info" />}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-foreground">{row.label}</span>
          {row.sub && <span className="truncate text-[10px] text-muted-foreground">{row.sub}</span>}
        </span>
      </span>
      <span className="shrink-0 text-muted-foreground">{fmtTokens(row.tokens)}</span>
    </li>
  );
}

// Detail rows for one expanded bucket. Its own component (keyed by group in the
// parent) so switching chips fully remounts — no stale rows can accumulate.
function GroupDetail({ data }: { data: GroupData }) {
  const { loaded, deferred } = data;
  if (loaded.length === 0 && deferred.length === 0) {
    return (
      <p className="border-t border-border pt-2 text-xs text-muted-foreground">
        Nothing in this group
      </p>
    );
  }
  return (
    <div className="space-y-3 border-t border-border pt-2">
      {loaded.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Loaded
          </h5>
          <ul className="space-y-1">
            {loaded.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are a positional, static list per render
              <GroupRowItem key={`l-${i}-${row.label}`} row={row} />
            ))}
          </ul>
        </div>
      )}
      {deferred.length > 0 && (
        <div className="space-y-1">
          <h5 className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deferred
            <span
              className="font-normal normal-case text-muted-foreground/70"
              title="Shown to the model but not loaded into the prompt until needed."
            >
              (not in prompt)
            </span>
          </h5>
          <ul className="space-y-1 opacity-60">
            {deferred.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are a positional, static list per render
              <GroupRowItem key={`d-${i}-${row.label}`} row={row} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ContextPanel({ sessionId }: ContextPanelProps) {
  const session = useSessionChat(sessionId);
  const contextUsage: ContextUsagePayload | null = session?.contextUsage ?? null;
  const isTurnInProgress = session?.isTurnInProgress ?? false;

  // Which bucket is expanded to show its detailed rows. Single-open; defaults to
  // the first chip (Messages) so it's visible the chips are clickable.
  const [expanded, setExpanded] = useState<GroupKey | null>('messages');

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

  const groups = contextUsage ? buildGroups(contextUsage) : null;
  const groupTotal = groups ? GROUP_META.reduce((sum, { key }) => sum + groups[key].tokens, 0) : 0;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <h4 className="text-base font-semibold text-foreground">Context</h4>
          <span
            className="text-muted-foreground/60"
            title="Context-window usage broken down by category, loaded skills, and memory files. Compact summarizes older turns to free space."
          >
            <Info className="h-3.5 w-3.5" />
          </span>
        </span>
        <button
          type="button"
          onClick={onCompact}
          disabled={compactDisabled}
          className="rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {compacting ? 'compacting…' : 'compact'}
        </button>
      </div>

      {contextUsage == null || groups == null ? (
        <p className="text-sm text-muted-foreground">Context unavailable</p>
      ) : (
        <>
          {/* Segmented usage bar: colored slices per bucket over a track. Slice
              widths are each bucket's share of the used tokens; the remaining
              track is free space. The trailing % is the SDK's reported usage. */}
          <div className="space-y-2">
            <div className="flex h-2.5 w-full items-center gap-px overflow-hidden rounded-full bg-muted">
              {GROUP_META.map(({ key, color }) => {
                const pct = groupTotal > 0 ? (groups[key].tokens / groupTotal) * 100 : 0;
                const usedPct = Math.min(100, Math.max(0, contextUsage.percentage));
                const width = (pct / 100) * usedPct;
                if (width <= 0) return null;
                return (
                  <span
                    key={key}
                    className="h-full first:rounded-l-full"
                    style={{ width: `${width}%`, backgroundColor: color }}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {fmtTokens(contextUsage.totalTokens)} / {fmtTokens(contextUsage.maxTokens)}
              </span>
              <span className="text-base font-semibold text-foreground">
                {Math.round(contextUsage.percentage)}%
              </span>
            </div>
          </div>

          {/* Grouped legend chips. Click to expand the bucket's detail rows. */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {GROUP_META.map(({ key, label, color }) => {
                const isOpen = expanded === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className={`flex items-center gap-1.5 text-xs transition-colors ${
                      isOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span className={isOpen ? 'underline underline-offset-4' : ''}>{label}</span>
                  </button>
                );
              })}
            </div>

            {expanded && <GroupDetail key={expanded} data={groups[expanded]} />}
          </div>
        </>
      )}
    </div>
  );
}
