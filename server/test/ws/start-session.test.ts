import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb, wsErrors } from '../_helpers';

// `start_session` is the single path that creates a session row — it does so
// only on a valid first message. These tests pin the validation gate and the
// no-row-on-reject invariant (the whole point of the lazy-create change). The
// happy path past `defaultSelectionForUser` spawns a real `claude` subprocess,
// so it is out of scope for an isolated unit test; we stop at the provider gate.

let manager: SessionManager;
let userSlug: string;
let workspaceRoot: string;
let validWorkDir: string;

beforeEach(async () => {
  manager = new SessionManager();
  workspaceRoot = '/tmp/mtc-webui-test';
  await mkdir(workspaceRoot, { recursive: true });
  const dir = await mkdtemp(path.join(workspaceRoot, 'start-test-'));
  userSlug = path.basename(dir);
  // A project folder directly under the user root → a slug-canonical project.
  validWorkDir = path.join(workspaceRoot, userSlug, 'demo');
  await mkdir(validWorkDir, { recursive: true });
});

afterEach(async () => {
  setHandlerDeps(null);
  await rm(path.join(workspaceRoot, userSlug), { recursive: true, force: true });
});

async function start(ws: FakeWS, payload: unknown): Promise<void> {
  await handleMessage(asWS(ws), JSON.stringify({ type: 'start_session', payload }));
}

describe('handleStartSession', () => {
  it('rejects bad_request when content is missing, inserting no row', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: validWorkDir });

    expect(wsErrors(ws)[0]?.payload.code).toBe('bad_request');
    expect(fake.calls.filter((c) => c.op === 'insert').length).toBe(0);
  });

  it('rejects bad_request when content is empty, inserting no row', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: validWorkDir, content: '' });

    expect(wsErrors(ws)[0]?.payload.code).toBe('bad_request');
    expect(fake.calls.filter((c) => c.op === 'insert').length).toBe(0);
  });

  it('rejects bad_request when workDir escapes the user root, inserting no row', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: '/etc/passwd', content: 'hi' });

    expect(wsErrors(ws)[0]?.payload.code).toBe('bad_request');
    expect(fake.calls.filter((c) => c.op === 'insert').length).toBe(0);
  });

  it('rejects bad_request on a non-canonical project name, inserting no row', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    // A space makes the derived project name non-slug-canonical.
    const badDir = path.join(workspaceRoot, userSlug, 'Bad Name');
    await mkdir(badDir, { recursive: true });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: badDir, content: 'hi' });

    expect(wsErrors(ws)[0]?.payload.code).toBe('bad_request');
    expect(fake.calls.filter((c) => c.op === 'insert').length).toBe(0);
  });

  it('inserts the row then replies provider_unset when no provider resolves', async () => {
    const fake = makeFakeDb();
    // resolveProviderForUser + defaultSelectionForUser both probe sessions/
    // providers and find nothing → the query spawn throws ProviderUnavailableError.
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await start(ws, { workDir: validWorkDir, content: 'hello' });

    const inserts = fake.calls.filter((c) => c.op === 'insert' && c.table === 'sessions');
    expect(inserts.length).toBe(1);
    const values = inserts[0]?.values as { workDir: string; status: string; title: null };
    expect(values.workDir).toBe(validWorkDir);
    expect(values.status).toBe('active');
    expect(values.title).toBeNull();

    expect(wsErrors(ws).some((e) => e.payload.code === 'provider_unset')).toBe(true);
  });
});
