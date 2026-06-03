import { Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router';
import type { Block } from 'shared/types';
import { useChatStore, useSessionChat } from '../lib/chat-store';
import { wsClient } from '../lib/ws-client';
import { sendWS } from '../lib/ws-send';
import { BlockRegistry } from './blocks/block-registry';
import { SubagentBundle } from './blocks/subagent-bundle';
import { ActivityTimeline, isRailEligible } from './blocks/timeline/activity-timeline';
import { groupRail } from './blocks/timeline/group-rail-segments';

type RenderItem =
  | { kind: 'block'; block: Block }
  | {
      kind: 'subagent-bundle';
      id: string;
      toolCall: Extract<Block, { kind: 'tool_call' }>;
      subagent: Extract<Block, { kind: 'subagent' }> | null;
      toolResult: Extract<Block, { kind: 'tool_result' }> | null;
    };

function bundleSubagents(blocks: Block[]): RenderItem[] {
  // Index subagents by parentToolCallId so we can attach them to their tool_call.
  const subagentByParent = new Map<string, Extract<Block, { kind: 'subagent' }>>();
  for (const b of blocks) {
    if (b.kind === 'subagent') subagentByParent.set(b.parentToolCallId, b);
  }

  const consumed = new Set<string>();
  const items: RenderItem[] = [];

  for (const b of blocks) {
    if (consumed.has(b.id)) continue;

    if (b.kind === 'tool_call' && subagentByParent.has(b.toolCallId)) {
      const subagent = subagentByParent.get(b.toolCallId) ?? null;
      const toolResult =
        (blocks.find((x) => x.kind === 'tool_result' && x.toolCallId === b.toolCallId) as
          | Extract<Block, { kind: 'tool_result' }>
          | undefined) ?? null;

      if (subagent) consumed.add(subagent.id);
      if (toolResult) consumed.add(toolResult.id);

      items.push({
        kind: 'subagent-bundle',
        id: `bundle:${b.toolCallId}`,
        toolCall: b,
        subagent,
        toolResult,
      });
      continue;
    }

    items.push({ kind: 'block', block: b });
  }

  return items;
}

/**
 * Group sequential rail-eligible blocks into ActivityTimeline segments.
 * Everything else (user, text, approval_request, question_request,
 * subagent-bundle) renders standalone — preserving the original ordering so
 * Timeline / bubble / Timeline interleaving works naturally.
 */
function groupIntoSegments(items: RenderItem[]) {
  return groupRail<RenderItem>(
    items,
    (it) => (it.kind === 'block' && isRailEligible(it.block) ? it.block : null),
    (it) => (it.kind === 'block' ? it.block.id : it.id),
  );
}

export function Transcript() {
  const { id: sessionId } = useParams<{ id: string }>();
  const session = useSessionChat(sessionId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  const blocks = session?.blocks || [];
  const isTurnInProgress = session?.isTurnInProgress || false;
  const segments = useMemo(() => groupIntoSegments(bundleSubagents(blocks)), [blocks]);

  // Hydrate session from server when we land on /session/:id directly (F5 / deep link).
  useEffect(() => {
    if (!sessionId) return;
    const hasSnapshot = !!useChatStore.getState().sessions[sessionId];
    if (hasSnapshot) return;

    let cancelled = false;
    const request = () => {
      if (cancelled) return;
      sendWS('resume_session', { sessionId });
    };

    if (wsClient.isOpen()) request();
    const unsubOpen = wsClient.on('open', () => request());
    return () => {
      cancelled = true;
      unsubOpen();
    };
  }, [sessionId]);

  // Auto-scroll to bottom on new content. Scroll the container directly rather
  // than `anchor.scrollIntoView()` — the latter bubbles to every scrollable
  // ancestor, and on mobile the layout/visual-viewport gap (bottom address bar)
  // makes it over-scroll the document, shoving the composer toward the middle.
  // Guard on near-bottom so reading scrollback isn't yanked back down.
  //
  // `blocks.length` is the intended trigger, not a read value: each new
  // streamed block must re-run the effect so it re-measures `scrollHeight` and
  // follows the bottom. Biome flags it as "unnecessary" because the body never
  // reads it directly — removing it would break auto-scroll, so suppress.
  // biome-ignore lint/correctness/useExhaustiveDependencies: blocks.length is a deliberate re-run trigger; the effect reads the derived scrollHeight, not the length itself.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 120;
    if (isTurnInProgress || nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: isTurnInProgress ? 'smooth' : 'auto' });
    }
  }, [blocks.length, isTurnInProgress]);

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center p-8 select-none">
        <div className="rounded-2xl bg-muted/40 p-4 border border-border/80 shadow-sm animate-pulse mb-4">
          <Terminal className="h-10 w-10 text-primary/40" />
        </div>
        <h3 className="text-sm font-semibold text-foreground/80">No active session</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Select or create a project from the sidebar to launch a coding task.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 select-none">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-ping" />
          <span>Loading session data...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scrollbar-thin select-none"
    >
      <div
        className="mx-auto max-w-3xl space-y-6"
        style={{ paddingBottom: 'max(6rem, calc(var(--approval-dock-h, 0px) + 1.5rem))' }}
      >
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center pt-24 pb-8 select-none">
            <h3 className="text-sm font-semibold text-foreground/90">Session ready</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">
              Ask anything to get started. The agent will run shell commands, write files, and show
              rich previews.
            </p>
          </div>
        ) : (
          segments.map((seg) => {
            if (seg.kind === 'rail') {
              return (
                <ActivityTimeline
                  key={seg.id}
                  items={seg.items}
                  isTurnInProgress={isTurnInProgress}
                />
              );
            }
            if (seg.item.kind === 'subagent-bundle') {
              return (
                <SubagentBundle
                  key={seg.id}
                  toolCall={seg.item.toolCall}
                  subagent={seg.item.subagent}
                  toolResult={seg.item.toolResult}
                />
              );
            }
            return <BlockRegistry key={seg.id} block={seg.item.block} />;
          })
        )}
        <div ref={bottomAnchorRef} />
      </div>
    </div>
  );
}
