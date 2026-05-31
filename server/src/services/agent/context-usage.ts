import type { ContextUsagePayload } from 'shared/types';
import { broadcastEvent } from '../../lib/ws-broadcast';
import type { ActiveSession } from '../session-manager';
import { sessionManager } from '../session-manager';

// Context-usage probe. Reads the live query's current context breakdown via the
// SDK control request, maps it to the wire payload, caches it on the session,
// and fans it out. A missing/dead query (no `active.query`, or a thrown control
// request) is a silent no-op — the cache and any prior UI value stay as-is.

/**
 * Refresh the session's context-usage snapshot from the live query and
 * broadcast it. Returns silently when there is no live query or the control
 * request throws (transport error / no live query), leaving the cache and UI
 * unchanged.
 */
export async function refreshContextUsage(active: ActiveSession): Promise<void> {
  if (!active.query) return;

  let res: Awaited<ReturnType<NonNullable<ActiveSession['query']>['getContextUsage']>>;
  try {
    res = await active.query.getContextUsage();
  } catch {
    return;
  }

  const payload: ContextUsagePayload = {
    percentage: res.percentage,
    totalTokens: res.totalTokens,
    maxTokens: res.maxTokens,
    model: res.model,
    categories: res.categories
      .filter((c) => c.name !== 'Free space')
      .map((c) => ({ name: c.name, tokens: c.tokens })),
    skills: (res.skills?.skillFrontmatter ?? []).map((s) => ({
      name: s.name,
      source: s.source,
      tokens: s.tokens,
    })),
    memoryFiles: res.memoryFiles.map((m) => ({ path: m.path, type: m.type, tokens: m.tokens })),
  };

  active.lastContextUsage = payload;
  broadcastEvent<ContextUsagePayload>(active, 'context_usage', payload, sessionManager);
}
