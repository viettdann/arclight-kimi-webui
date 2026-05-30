import { Brain, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from 'shared/types';
import { ErrorBlock } from '../error-block';
import { adapterFor, SUMMARY_VERB } from './adapter-registry';
import {
  ApprovalBadge,
  approvalBlockToRow,
  PendingApprovalBadge,
} from './adapters/approval-adapter';
import { thinkingBlockToRow } from './adapters/think-adapter';
import { TerminalOutput } from './terminal-output';
import { TimelineRow } from './timeline-row';
import type {
  ApprovalRailBlock,
  RailBlock,
  RailRowShape,
  ThinkingBlock as ThinkingB,
  ToolCallBlock,
  ToolResultBlock,
} from './types';
import { readArgString } from './types';

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
  // Approvals fold into the matching tool_call row: pending → amber heading
  // + buttons inside detail; resolved → small badge next to the verb.
  // A pending approval without a matching tool_call (race) falls back to its
  // own row so the user can still act on it.
  const resultByCallId = new Map<string, ToolResultBlock>();
  const resolvedApprovalByCallId = new Map<string, ApprovalRailBlock>();
  const pendingApprovalByCallId = new Map<string, ApprovalRailBlock>();
  const toolCallIds = new Set<string>();
  for (const b of items) {
    if (b.kind === 'tool_result') resultByCallId.set(b.toolCallId, b);
    if (b.kind === 'tool_call') toolCallIds.add(b.toolCallId);
    if (b.kind === 'approval_request') {
      if (b.resolution != null) resolvedApprovalByCallId.set(b.toolCallId, b);
      else pendingApprovalByCallId.set(b.toolCallId, b);
    }
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
      const approval = resolvedApprovalByCallId.get(b.toolCallId);
      if (approval) shape.badge = <ApprovalBadge approval={approval} />;
      rows.push({ key: b.id, shape });
      bump(verbCount, b.toolName);
      continue;
    }
    if (b.kind === 'tool_call') {
      const result = resultByCallId.get(b.toolCallId) ?? null;
      if (result) consumedResultIds.add(result.id);
      const shape = adapterFor(b.name)({ call: b, result });
      const pending = pendingApprovalByCallId.get(b.toolCallId);
      const resolved = resolvedApprovalByCallId.get(b.toolCallId);
      if (pending) {
        // No spinner while we wait on the user. The amber shield + pill on
        // this row anchor the request in chronological context; the actual
        // decision UI (Approve/Deny) lives in the bottom dock so the user
        // can act without scrolling. A thin amber left-strip on the command
        // preview echoes the dock's accent.
        shape.icon = <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />;
        shape.status = 'ok';
        shape.badge = <PendingApprovalBadge />;
        if (b.name === 'Bash') {
          const command = readArgString(b, 'command');
          shape.detail = (
            <div className="rounded-md border border-border/70 border-l-2 border-l-amber-500/60 overflow-hidden">
              <TerminalOutput command={command} borderless />
            </div>
          );
        }
        // Non-Shell tools keep their adapter's existing detail unchanged —
        // the dock is the only decision surface.
      } else if (resolved) {
        shape.badge = <ApprovalBadge approval={resolved} />;
      }
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
    if (b.kind === 'approval_request') {
      const ab = b as ApprovalRailBlock;
      // Resolved or merged-into-tool_call cases were handled when their
      // matching tool_call row rendered. Only orphan pending approvals
      // (no tool_call yet) fall through to a standalone row.
      if (ab.resolution != null) continue;
      if (toolCallIds.has(ab.toolCallId)) continue;
      rows.push({ key: b.id, shape: approvalBlockToRow(ab) });
      // Don't count approvals in the summary — they're not an action verb.
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
  // edits/writes first
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'TodoWrite',
  // commands
  'Bash',
  'BashOutput',
  'KillShell',
  // reads/searches
  'Glob',
  'Grep',
  'Read',
  // web
  'WebSearch',
  'WebFetch',
  // delegation + questions
  'Task',
  'AskUserQuestion',
  // native thinking
  'Think',
];

/** Tools whose summary token deserves a leading glyph. */
const SUMMARY_ICON: Record<string, ReactNode> = {
  Think: <Brain className="h-3.5 w-3.5 text-primary/70" />,
};

/**
 * Compose a short human summary like "Created file, Ran 2 commands". When
 * n===1 the count is dropped so headers stay tight ("Thought", not "Thought
 * 1"). Verb glyphs (e.g. the brain badge on "Thought") only appear when the
 * segment is alone — once mixed with other verbs the icon becomes visual
 * noise next to the chevron and plain verbs.
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
  const trimmed = parts.slice(0, 3);
  if (trimmed.length > 1) {
    return trimmed.map(({ icon: _icon, ...rest }) => rest);
  }
  return trimmed;
}

function countLabel(verb: string, n: number, tool: string): string {
  // Pick a noun suffix per tool. Keep it short.
  const noun: Record<string, string> = {
    Write: n === 1 ? 'file' : 'files',
    Edit: n === 1 ? 'file' : 'files',
    MultiEdit: n === 1 ? 'file' : 'files',
    NotebookEdit: n === 1 ? 'notebook' : 'notebooks',
    Bash: n === 1 ? 'command' : 'commands',
    BashOutput: '',
    KillShell: n === 1 ? 'shell' : 'shells',
    Glob: n === 1 ? 'search' : 'searches',
    Grep: n === 1 ? 'search' : 'searches',
    WebSearch: n === 1 ? 'query' : 'queries',
    WebFetch: n === 1 ? 'URL' : 'URLs',
    Read: n === 1 ? 'file' : 'files',
    Task: n === 1 ? 'task' : 'tasks',
    AskUserQuestion: n === 1 ? 'question' : 'questions',
    // Verb "Thought" is already a complete phrase for n===1 — only add the
    // noun for plural counts to avoid "Thought thought".
    Think: n === 1 ? '' : 'thoughts',
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
    b.kind === 'error' ||
    b.kind === 'approval_request'
  );
}
