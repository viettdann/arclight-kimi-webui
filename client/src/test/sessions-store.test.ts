import type { SessionListItem } from 'shared/types';
import { describe, expect, it } from 'vitest';
import { groupByProject } from '@/lib/sessions-store';

// groupByProject only reads `projectName` and `lastActiveAt`; keep fixtures minimal.
const sess = (id: string, projectName: string, lastActiveAt: string): SessionListItem =>
  ({ id, projectName, lastActiveAt }) as SessionListItem;

describe('groupByProject', () => {
  it('returns an empty map for no sessions', () => {
    expect(groupByProject([])).toEqual({});
  });

  it('buckets sessions by projectName', () => {
    const grouped = groupByProject([
      sess('a', 'proj1', '2026-01-01T00:00:00Z'),
      sess('b', 'proj2', '2026-01-01T00:00:00Z'),
      sess('c', 'proj1', '2026-01-02T00:00:00Z'),
    ]);
    expect(Object.keys(grouped).sort()).toEqual(['proj1', 'proj2']);
    expect(grouped.proj1?.map((s) => s.id).sort()).toEqual(['a', 'c']);
    expect(grouped.proj2?.map((s) => s.id)).toEqual(['b']);
  });

  it('sorts each bucket by lastActiveAt descending (most recent first)', () => {
    const grouped = groupByProject([
      sess('old', 'p', '2026-01-01T00:00:00Z'),
      sess('new', 'p', '2026-03-01T00:00:00Z'),
      sess('mid', 'p', '2026-02-01T00:00:00Z'),
    ]);
    expect(grouped.p?.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });
});
