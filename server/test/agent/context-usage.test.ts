import { describe, expect, it, mock } from 'bun:test';
import type { ContextUsagePayload } from 'shared/types';
import type { ActiveSession } from '../../src/services/session-manager';

// refreshContextUsage's only emit path is broadcastEvent — capture it.
type Broadcast = { type: string; payload: ContextUsagePayload };
const broadcasts: Broadcast[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload: payload as ContextUsagePayload });
    return { type, payload };
  },
}));

const { refreshContextUsage } = await import('../../src/services/agent/context-usage');
const { SessionManager } = await import('../../src/services/session-manager');

// A getContextUsage response shaped like SDKControlGetContextUsageResponse, with
// only the fields refreshContextUsage reads. A 'Free space' category is present
// to assert it is filtered out.
function fixture() {
  return {
    categories: [
      { name: 'System prompt', tokens: 1200, color: '#111' },
      { name: 'Messages', tokens: 3400, color: '#222' },
      { name: 'Free space', tokens: 95400, color: '#333' },
    ],
    totalTokens: 4600,
    maxTokens: 100000,
    rawMaxTokens: 100000,
    percentage: 4.6,
    model: 'kimi-k2',
    memoryFiles: [
      { path: '/w/CLAUDE.md', type: 'project', tokens: 300 },
      { path: '/home/u/.claude/CLAUDE.md', type: 'user', tokens: 150 },
    ],
    mcpTools: [],
    skills: {
      totalSkills: 2,
      includedSkills: 1,
      tokens: 220,
      skillFrontmatter: [{ name: 'brainstorming', source: 'plugin', tokens: 220 }],
    },
  };
}

function makeActive(query: ActiveSession['query']): ActiveSession {
  const sm = new SessionManager();
  const active = sm.register({
    sessionId: 's1',
    userId: 'u1',
    workDir: '/w',
    approvalMode: 'ask',
  });
  active.query = query;
  return active;
}

describe('refreshContextUsage', () => {
  it('maps the SDK response, caches it, and broadcasts context_usage', async () => {
    broadcasts.length = 0;
    const res = fixture();
    const active = makeActive({
      getContextUsage: async () => res,
    } as unknown as ActiveSession['query']);

    await refreshContextUsage(active);

    const expected: ContextUsagePayload = {
      percentage: 4.6,
      totalTokens: 4600,
      maxTokens: 100000,
      model: 'kimi-k2',
      // 'Free space' excluded.
      categories: [
        { name: 'System prompt', tokens: 1200 },
        { name: 'Messages', tokens: 3400 },
      ],
      skills: [{ name: 'brainstorming', source: 'plugin', tokens: 220 }],
      memoryFiles: [
        { path: '/w/CLAUDE.md', type: 'project', tokens: 300 },
        { path: '/home/u/.claude/CLAUDE.md', type: 'user', tokens: 150 },
      ],
    };

    expect(active.lastContextUsage).toEqual(expected);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe('context_usage');
    expect(broadcasts[0]?.payload).toEqual(expected);
  });

  it('defaults skills to [] when skillFrontmatter is absent', async () => {
    broadcasts.length = 0;
    const res = fixture();
    res.skills = undefined as unknown as ReturnType<typeof fixture>['skills'];
    const active = makeActive({
      getContextUsage: async () => res,
    } as unknown as ActiveSession['query']);

    await refreshContextUsage(active);

    expect(active.lastContextUsage?.skills).toEqual([]);
    expect(broadcasts).toHaveLength(1);
  });

  it('is a silent no-op when there is no live query', async () => {
    broadcasts.length = 0;
    const active = makeActive(null);

    await refreshContextUsage(active);

    expect(active.lastContextUsage).toBeNull();
    expect(broadcasts).toHaveLength(0);
  });

  it('leaves the cache unchanged and does not broadcast when getContextUsage throws', async () => {
    broadcasts.length = 0;
    const prior: ContextUsagePayload = {
      percentage: 1,
      totalTokens: 10,
      maxTokens: 100,
      model: 'old',
      categories: [],
      skills: [],
      memoryFiles: [],
    };
    const active = makeActive({
      getContextUsage: async () => {
        throw new Error('no live query');
      },
    } as unknown as ActiveSession['query']);
    active.lastContextUsage = prior;

    await refreshContextUsage(active);

    expect(active.lastContextUsage).toBe(prior);
    expect(broadcasts).toHaveLength(0);
  });
});
