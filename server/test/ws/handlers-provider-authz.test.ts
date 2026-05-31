import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ProviderRow } from '../../src/db/schema';
import { SessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, wsErrors } from '../_helpers';

// Send-path authz for provider switching. A providerId the user may NOT use
// (a private built-in for a non-admin, or another user's personal provider)
// must be rejected with `provider_unset` and MUST NOT mutate the session row.
//
// The session is pre-registered in the manager, so `getOrRestore` returns it
// from memory — no DB hit before the provider guard. The only DB the guard
// touches is `resolveProviderForUser`, primed via makeFakeDb's selectQueue.

const NOW = new Date('2026-01-01T00:00:00Z');

function makeProvider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'prov-x',
    ownerUserId: null,
    type: 'api',
    visibility: 'public',
    namespace: 'TestNS',
    baseUrl: null,
    token: 'tok-abcd1234',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let manager: SessionManager;

beforeEach(() => {
  manager = new SessionManager();
});

afterEach(() => {
  setHandlerDeps(null);
});

describe('handleSendMessage — provider authz on switch', () => {
  it('private built-in for a non-admin user → provider_unset, session row untouched', async () => {
    // Session pinned to its current provider; the send tries to switch to a
    // private built-in the non-admin user is not allowed to use.
    manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      providerId: 'prov-current',
      model: 'model-a',
    });

    const fake = makeFakeDb();
    // resolveProviderForUser → getProviderRow: provider row, then its models.
    const privateBuiltin = makeProvider({
      id: 'prov-priv',
      ownerUserId: null,
      visibility: 'private',
    });
    fake.selectQueue.push([privateBuiltin]); // select providers
    fake.selectQueue.push([]); // select provider_models
    // ownerUserId === null + private → getUserRole lookup returns non-admin.
    fake.selectQueue.push([{ role: 'user' }]);
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await handleMessage(
      asWS(alice),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-1',
        payload: { content: 'hi', providerId: 'prov-priv' },
      }),
    );

    // (1) Session row NOT updated — the guard returns before any persist.
    expect(fake.calls.filter((c) => c.op === 'update').length).toBe(0);
    const active = manager.peek('sess-1');
    expect(active?.providerId).toBe('prov-current');
    // (2) provider_unset error was sent for this session.
    const err = wsErrors(alice).at(-1);
    expect(err?.payload.code).toBe('provider_unset');
    expect(err?.sessionId).toBe('sess-1');
  });

  it("another user's personal provider → provider_unset, session row untouched", async () => {
    manager.register({
      sessionId: 'sess-2',
      userId: 'alice',
      workDir: '/tmp/work',
      providerId: 'prov-current',
      model: 'model-a',
    });

    const fake = makeFakeDb();
    // Personal provider owned by bob — resolve returns null without a role query.
    const bobsProvider = makeProvider({
      id: 'prov-bob',
      ownerUserId: 'bob',
      visibility: null,
    });
    fake.selectQueue.push([bobsProvider]); // select providers
    fake.selectQueue.push([]); // select provider_models
    setHandlerDeps({ manager, db: fake.db });

    const alice = new FakeWS('alice');
    await handleMessage(
      asWS(alice),
      JSON.stringify({
        type: 'send_message',
        sessionId: 'sess-2',
        payload: { content: 'hi', providerId: 'prov-bob' },
      }),
    );

    expect(fake.calls.filter((c) => c.op === 'update').length).toBe(0);
    const active = manager.peek('sess-2');
    expect(active?.providerId).toBe('prov-current');
    const err = wsErrors(alice).at(-1);
    expect(err?.payload.code).toBe('provider_unset');
    expect(err?.sessionId).toBe('sess-2');
  });
});
