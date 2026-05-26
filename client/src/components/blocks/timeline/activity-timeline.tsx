import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Block } from 'shared/types';
import { ErrorBlock } from '../error-block';
import { adapterFor, SUMMARY_VERB } from './adapter-registry';
import { thinkingBlockToRow } from './adapters/think-adapter';
import { TimelineRow } from './timeline-row';
import type {
  RailBlock,
  RailRowShape,
  ThinkingBlock as ThinkingB,
  ToolCallBlock,
  ToolResultBlock,
} from './types';

interface ActivityTimelineProps {
  items: RailBlock[];
  /** Whether the parent turn is still streaming. Drives auto-collapse + loading hint. */
  isTurnInProgress: boolean;
}

/**
 * Renders a vertical activity rail. Pairs tool_call↔tool_result by toolCallId,
 * skipping consumed results. Renders thinking blocks via dedicated card.
 *
 * Auto-collapses after the turn finishes, showing only the summary header
 * (e.g. "Created 1 file, Ran command 2 commands"). User can re-expand.
 */
export function ActivityTimeline({ items, isTurnInProgress }: ActivityTimelineProps) {
  const { rows, summary } = useMemo(() => buildRows(items), [items]);

  const [collapsed, setCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);

  // On turn-end, auto-collapse once. Respect manual user toggle thereafter.
  useEffect(() => {
    if (!isTurnInProgress && !autoCollapsedRef.current && rows.length > 0) {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    }
  }, [isTurnInProgress, rows.length]);

  if (rows.length === 0) return null;

  return (
    <div className="w-full animate-in fade-in duration-200">
      {/* Collapse header — always available so user can re-toggle. */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/85 hover:text-foreground transition-colors cursor-pointer mb-2 select-none"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        <span className="font-medium inline-flex items-center gap-1 flex-wrap">
          {summary.length === 0 ? (
            <span>{`${rows.length} activities`}</span>
          ) : (
            summary.map((seg, i) => (
              <Fragment key={seg.key}>
                {i > 0 && <span className="text-muted-foreground/60">,</span>}
                <span className="inline-flex items-center gap-1">
                  {seg.icon}
                  <span>{seg.label}</span>
                </span>
              </Fragment>
            ))
          )}
        </span>
      </button>

      {!collapsed && (
        <ul className="relative border-l border-border/60 pl-0 ml-2 space-y-4 py-1">
          {rows.map((r) => (
            <TimelineRow key={r.key} shape={r.shape} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One token of the rail summary header (e.g. "Thought", "Ran 2 commands"). */
interface SummarySegment {
  /** Stable key for React. */
  key: string;
  /** Optional leading icon shown right before the label. */
  icon?: ReactNode;
  label: string;
}

interface BuildResult {
  rows: { key: string; shape: RailRowShape }[];
  summary: SummarySegment[];
}

function buildRows(items: RailBlock[]): BuildResult {
  // Index results by toolCallId. Pair them with their calls; orphan results
  // (no matching call) get rendered as fallback rows so nothing is lost.
  const resultByCallId = new Map<string, ToolResultBlock>();
  for (const b of items) {
    if (b.kind === 'tool_result') resultByCallId.set(b.toolCallId, b);
  }

  const consumedResultIds = new Set<string>();
  const rows: { key: string; shape: RailRowShape }[] = [];
  const verbCount = new Map<string, number>();

  for (const b of items) {
    if (b.kind === 'tool_result') {
      if (consumedResultIds.has(b.id)) continue;
      // Orphan tool_result — render as a minimal row using fallback adapter.
      const fake: ToolCallBlock = {
        kind: 'tool_call',
        id: `synth-${b.id}`,
        toolCallId: b.toolCallId,
        name: b.toolName,
        args: null,
        isStreaming: false,
        createdAt: b.createdAt,
      };
      const shape = adapterFor(b.toolName)({ call: fake, result: b });
      rows.push({ key: b.id, shape });
      bump(verbCount, b.toolName);
      continue;
    }
    if (b.kind === 'tool_call') {
      const result = resultByCallId.get(b.toolCallId) ?? null;
      if (result) consumedResultIds.add(result.id);
      const shape = adapterFor(b.name)({ call: b, result });
      rows.push({ key: b.id, shape });
      bump(verbCount, b.name);
      continue;
    }
    if (b.kind === 'thinking') {
      const tb = b as ThinkingB;
      rows.push({ key: b.id, shape: thinkingBlockToRow(tb) });
      bump(verbCount, 'Think');
      continue;
    }
    if (b.kind === 'error') {
      rows.push({
        key: b.id,
        shape: {
          icon: <span className="text-red-500">!</span>,
          verb: 'Error',
          inline: <span className="font-mono text-red-500/85">{b.code}</span>,
          detail: <ErrorBlock code={b.code} message={b.message} createdAt={b.createdAt} />,
          status: 'error',
        },
      });
    }
  }

  return { rows, summary: summarize(verbCount) };
}

function bump(m: Map<string, number>, key: string) {
  m.set(key, (m.get(key) ?? 0) + 1);
}

const SUMMARY_PRIORITY = [
  'WriteFile',
  'StrReplaceFile',
  'SetTodoList',
  'Shell',
  'SearchWeb',
  'FetchURL',
  'Glob',
  'Grep',
  'ReadFile',
  'ReadMediaFile',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'ExitPlanMode',
  'Think',
];

/** Tools whose summary token deserves a leading glyph. */
const SUMMARY_ICON: Record<string, ReactNode> = {
  Think: <Brain className="h-3.5 w-3.5 text-primary/70" />,
};

/**
 * Compose a short human summary like "Created file, Ran 2 commands". When
 * n===1 the count is dropped so headers stay tight ("Thought", not "Thought
 * 1"). Each segment may carry an icon — e.g. the brain badge on "Thought".
 */
function summarize(verbCount: Map<string, number>): SummarySegment[] {
  const parts: SummarySegment[] = [];
  for (const tool of SUMMARY_PRIORITY) {
    const n = verbCount.get(tool);
    if (!n) continue;
    const verb = SUMMARY_VERB[tool] ?? tool;
    parts.push({
      key: tool,
      icon: SUMMARY_ICON[tool],
      label: countLabel(verb, n, tool),
    });
  }
  return parts.slice(0, 3);
}

function countLabel(verb: string, n: number, tool: string): string {
  // Pick a noun suffix per tool. Keep it short.
  const noun: Record<string, string> = {
    WriteFile: n === 1 ? 'file' : 'files',
    StrReplaceFile: n === 1 ? 'file' : 'files',
    Shell: n === 1 ? 'command' : 'commands',
    Glob: n === 1 ? 'search' : 'searches',
    Grep: n === 1 ? 'search' : 'searches',
    SearchWeb: n === 1 ? 'query' : 'queries',
    FetchURL: n === 1 ? 'URL' : 'URLs',
    ReadFile: n === 1 ? 'file' : 'files',
    ReadMediaFile: 'media',
    // Verb "Thought" is already a complete phrase for n===1 — only add the
    // noun for plural counts to avoid "Thought thought".
    Think: n === 1 ? '' : 'thoughts',
    SetTodoList: 'todo',
    TaskList: '',
    TaskOutput: '',
    TaskStop: '',
    ExitPlanMode: '',
  };
  const suffix = noun[tool];
  if (suffix == null || suffix === '') return verb;
  if (n === 1) return `${verb} ${suffix}`;
  return `${verb} ${n} ${suffix}`;
}

export function isRailEligible(b: Block): b is RailBlock {
  return (
    b.kind === 'thinking' ||
    b.kind === 'tool_call' ||
    b.kind === 'tool_result' ||
    b.kind === 'error'
  );
}
