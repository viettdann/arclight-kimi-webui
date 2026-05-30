import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '../../src/services/session-manager';
import { handleMessage, setHandlerDeps } from '../../src/ws/handlers';
import { asWS, FakeWS, makeFakeDb } from '../_helpers';

// Server test setup pins WORKSPACE_ROOT to /tmp/mtc-webui-test; adoption mkdirs
// `<WORKSPACE_ROOT>/<userSlug>/<projectName>`. We carve a unique slug per test
// to avoid cross-test FS interference inside that root.

let manager: SessionManager;
let userSlug: string;
let workspaceRoot: string;

beforeEach(async () => {
  manager = new SessionManager();
  workspaceRoot = '/tmp/mtc-webui-test';
  // Unique slug per test, materialised under workspaceRoot. `mkdtemp` does not
  // create parents, so ensure the root exists (self-contained per isolation).
  await mkdir(workspaceRoot, { recursive: true });
  const dir = await mkdtemp(path.join(workspaceRoot, 'adopt-test-'));
  userSlug = path.basename(dir);
});

afterEach(async () => {
  setHandlerDeps(null);
  await rm(path.join(workspaceRoot, userSlug), { recursive: true, force: true });
});

describe('handleAdoptProject', () => {
  it('rejects bad_request when projectName is empty', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await handleMessage(
      asWS(ws),
      JSON.stringify({ type: 'adopt_project', payload: { projectName: '' } }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error') as Array<{
      payload: { code: string };
    }>;
    expect(errors[0]?.payload.code).toBe('bad_request');
  });

  it('rejects bad_request when projectName is not slug-canonical', async () => {
    const fake = makeFakeDb();
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await handleMessage(
      asWS(ws),
      JSON.stringify({ type: 'adopt_project', payload: { projectName: 'Foo Bar' } }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error') as Array<{
      payload: { code: string };
    }>;
    expect(errors[0]?.payload.code).toBe('bad_request');
    expect(fake.calls.filter((c) => c.op === 'update').length).toBe(0);
  });

  it('replies not_found when no rows match (userId, projectName)', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]); // pre-update probe → empty
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await handleMessage(
      asWS(ws),
      JSON.stringify({ type: 'adopt_project', payload: { projectName: 'ghost' } }),
    );

    const errors = ws.parsed().filter((m) => m.type === 'error') as Array<{
      payload: { code: string };
    }>;
    expect(errors[0]?.payload.code).toBe('not_found');
  });

  it('happy path: cascades UPDATE, mkdirs folder, emits project_adopted', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([{ id: 's1' }, { id: 's2' }]);
    setHandlerDeps({ manager, db: fake.db });

    const ws = new FakeWS('alice', userSlug);
    await handleMessage(
      asWS(ws),
      JSON.stringify({ type: 'adopt_project', payload: { projectName: 'mtc-dev' } }),
    );

    const updates = fake.calls.filter((c) => c.op === 'update');
    expect(updates.length).toBe(1);

    const expectedWorkDir = path.join(workspaceRoot, userSlug, 'mtc-dev');
    expect((updates[0]?.values as { workDir: string }).workDir).toBe(expectedWorkDir);

    const s = await stat(expectedWorkDir);
    expect(s.isDirectory()).toBe(true);

    const adopted = ws.parsed().filter((m) => m.type === 'project_adopted') as Array<{
      payload: { projectName: string; workDir: string; sessionCount: number };
    }>;
    expect(adopted.length).toBe(1);
    expect(adopted[0]?.payload).toEqual({
      projectName: 'mtc-dev',
      workDir: expectedWorkDir,
      sessionCount: 2,
    });
  });
});
