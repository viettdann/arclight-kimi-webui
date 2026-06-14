import { describe, expect, it, mock } from 'bun:test';
import type { CommandsAvailablePayload } from 'shared/types';
import type { ActiveSession } from '../../src/services/session-manager';
import { SessionManager } from '../../src/services/session-manager';

// syncSkillsForUser fans a skill change out to a user's live sessions: it refreshes
// each catalog (so the picker accepts /skill at once) and disposes idle
// subprocesses so the next turn reloads skills. A mid-turn session is flagged
// `skillsDirty` instead of disposed (disposing would abort the running turn).

const broadcasts: { type: string; payload: unknown }[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_a: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload });
    return { type, payload };
  },
}));

let enabledRows: { name: string; description: string; enabled: boolean }[] = [];
mock.module('../../src/services/skills/store', () => ({
  listSkills: async () => enabledRows,
  // Other exports are pulled in transitively (restore.ts) — stub so the module
  // graph resolves; unused by this test.
  listEnabledSkillMeta: async () => [],
  getSkillArchive: async () => null,
}));

const { syncSkillsForUser } = await import('../../src/services/agent/skill-sync');

const fakeDb = {} as never;

function liveSession(m: SessionManager, id: string, over: Partial<ActiveSession> = {}) {
  const active = m.register({ sessionId: id, userId: 'u1', workDir: `/tmp/${id}` });
  const fakes = { aborted: false };
  active.query = { interrupt: async () => {} } as unknown as ActiveSession['query'];
  active.abortController = {
    abort: () => {
      fakes.aborted = true;
    },
  } as unknown as AbortController;
  active.bridge = { close: () => {} } as unknown as ActiveSession['bridge'];
  Object.assign(active, over);
  return { active, fakes };
}

describe('syncSkillsForUser', () => {
  it('refreshes the catalog and disposes an idle subprocess', async () => {
    broadcasts.length = 0;
    enabledRows = [{ name: 'pdf', description: 'Read a PDF', enabled: true }];
    const m = new SessionManager();
    const { active, fakes } = liveSession(m, 's1');

    await syncSkillsForUser(m, fakeDb, 'u1');

    // Idle → disposed so the next turn respawns with skills loaded.
    expect(fakes.aborted).toBe(true);
    expect(active.query).toBeNull();
    // Catalog refreshed + broadcast immediately.
    const ev = broadcasts.find((b) => b.type === 'commands_available');
    expect((ev?.payload as CommandsAvailablePayload).commands.map((c) => c.name)).toContain('pdf');
    expect(active.commands?.map((c) => c.name)).toContain('pdf');
  });

  it('defers to skillsDirty for a mid-turn session (does not abort it)', async () => {
    broadcasts.length = 0;
    enabledRows = [{ name: 'pdf', description: '', enabled: true }];
    const m = new SessionManager();
    const { active, fakes } = liveSession(m, 's2', { turnInProgress: true });

    await syncSkillsForUser(m, fakeDb, 'u1');

    expect(fakes.aborted).toBe(false);
    expect(active.query).not.toBeNull();
    expect(active.skillsDirty).toBe(true);
    // Catalog still refreshed so the picker is current.
    expect(active.commands?.map((c) => c.name)).toContain('pdf');
  });

  it('only enabled skills reach the catalog', async () => {
    enabledRows = [
      { name: 'on', description: '', enabled: true },
      { name: 'off', description: '', enabled: false },
    ];
    const m = new SessionManager();
    const { active } = liveSession(m, 's3');

    await syncSkillsForUser(m, fakeDb, 'u1');

    expect(active.commands?.map((c) => c.name)).toEqual(['on']);
  });

  it('is a no-op when the user has no in-memory sessions', async () => {
    broadcasts.length = 0;
    const m = new SessionManager();
    await syncSkillsForUser(m, fakeDb, 'nobody');
    expect(broadcasts.length).toBe(0);
  });
});
