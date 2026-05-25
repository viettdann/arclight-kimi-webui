import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const AUTO_COLLAPSE_MIN_ITEMS = 3;

/**
 * Renders a vertical activity rail. Pairs tool_call↔tool_result by toolCallId,
 * skipping consumed results. Renders thinking blocks via dedicated card.
 *
 * Auto-collapses after the turn finishes if there are ≥3 items, showing a
 * summary like "Created 1 file, Updated todo".
 */
export function ActivityTimeline({ items, isTurnInProgress }: ActivityTimelineProps) {
  const { rows, summary, terminalActions } = useMemo(() => buildRows(items), [items]);

  const [collapsed, setCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);

  // On turn-end, auto-collapse once if the rail has enough rows. Respect manual
  // user toggle thereafter.
  useEffect(() => {
    if (
      !isTurnInProgress &&
      !autoCollapsedRef.current &&
      terminalActions >= AUTO_COLLAPSE_MIN_ITEMS
    ) {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    }
  }, [isTurnInProgress, terminalActions]);

  if (rows.length === 0) return null;

  return (
    <div className="w-full animate-in fade-in duration-200">
      {/* Collapse header */}
      {(collapsed || summary) && (
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
          <span className="font-medium">{summary || `${rows.length} activities`}</span>
        </button>
      )}

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

interface BuildResult {
  rows: { key: string; shape: RailRowShape }[];
  summary: string | null;
  terminalActions: number;
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
  let terminal = 0;

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
      if (shape.status !== 'running') terminal++;
      continue;
    }
    if (b.kind === 'tool_call') {
      const result = resultByCallId.get(b.toolCallId) ?? null;
      if (result) consumedResultIds.add(result.id);
      const shape = adapterFor(b.name)({ call: b, result });
      rows.push({ key: b.id, shape });
      bump(verbCount, b.name);
      if (shape.status !== 'running') terminal++;
      continue;
    }
    if (b.kind === 'thinking') {
      const tb = b as ThinkingB;
      rows.push({ key: b.id, shape: thinkingBlockToRow(tb) });
      bump(verbCount, 'Think');
      if (!tb.isStreaming) terminal++;
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
      terminal++;
    }
  }

  return { rows, summary: summarize(verbCount), terminalActions: terminal };
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

/**
 * Compose a short human summary like "Created 1 file, Updated todo".
 * Uses the priority above so prominent actions surface first. Returns null
 * when the activity is too sparse to be worth summarizing.
 */
function summarize(verbCount: Map<string, number>): string | null {
  const parts: string[] = [];
  for (const tool of SUMMARY_PRIORITY) {
    const n = verbCount.get(tool);
    if (!n) continue;
    const verb = SUMMARY_VERB[tool] ?? tool;
    parts.push(verbCount.size === 1 ? `${verb} ${n}` : countLabel(verb, n, tool));
  }
  if (parts.length === 0) return null;
  return parts.slice(0, 3).join(', ');
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
    Think: n === 1 ? 'thought' : 'thoughts',
    SetTodoList: 'todo',
    TaskList: '',
    TaskOutput: '',
    TaskStop: '',
    ExitPlanMode: '',
  };
  const suffix = noun[tool];
  if (suffix == null || suffix === '') return verb;
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
