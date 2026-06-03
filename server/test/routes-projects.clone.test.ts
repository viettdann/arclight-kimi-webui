import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import type { CloneProgressPayload, ProjectCreateResponse } from 'shared/types';
import type { AuthVariables } from '../src/auth/middleware';
import type { AuditEvent } from '../src/lib/logger';
import { createProjectsRoutes } from '../src/routes/projects';
import type { CloneRepoArgs, CloneResult } from '../src/services/git/clone';
import { makeFakeDb } from './_helpers';

type CloneStub = (args: CloneRepoArgs) => Promise<CloneResult>;

let tmpRoot: string;
let userRoot: string;
let audit: AuditEvent[];

const mockUser = { id: 'u1', email: 'alice@example.com' };

// Collects clone-progress frames and exposes a promise that resolves on the
// terminal (completed/failed) frame — the async clone has no other signal.
function makeProgress() {
  const messages: CloneProgressPayload[] = [];
  let resolveTerminal!: (p: CloneProgressPayload) => void;
  const terminal = new Promise<CloneProgressPayload>((r) => {
    resolveTerminal = r;
  });
  const notify = (_userId: string, payload: CloneProgressPayload) => {
    messages.push(payload);
    if (payload.status === 'completed' || payload.status === 'failed') resolveTerminal(payload);
  };
  return { messages, terminal, notify };
}

function buildApp(
  cloneRepo: CloneStub,
  notify?: (userId: string, payload: CloneProgressPayload) => void,
): { app: Hono<{ Variables: AuthVariables }>; fake: ReturnType<typeof makeFakeDb> } {
  const fake = makeFakeDb();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', mockUser as never);
    c.set('authSession', null);
    await next();
  });
  app.route(
    '/api/projects',
    createProjectsRoutes({
      env: { WORKSPACE_ROOT: tmpRoot, GIT_CLONE_TIMEOUT_MS: 1000 },
      auditLog: (e) => {
        audit.push(e);
      },
      db: fake.db,
      cloneRepo: cloneRepo as never,
      notifyCloneProgress: notify,
    }),
  );
  return { app, fake };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const cloneBody = (sourceOver: Record<string, unknown> = {}, name?: string): string =>
  JSON.stringify({
    ...(name === undefined ? {} : { name }),
    source: {
      type: 'clone',
      url: 'https://github.com/acme/widgets.git',
      inlineToken: 'tok',
      provider: 'github',
      ...sourceOver,
    },
  });

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'mtc-projects-clone-test-'));
  userRoot = path.join(tmpRoot, 'alice');
  audit = [];
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/projects clone flow', () => {
  it('accepts the clone, returns a cloneId, then completes in the background', async () => {
    const prog = makeProgress();
    const { app } = buildApp(async () => ({ ok: true }), prog.notify);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;
    expect(body.name).toBe('widgets');
    expect(body.origin).toBe('local');
    expect(body.status).toBe('cloning');
    expect(typeof body.cloneId).toBe('string');
    expect(body.workDir).toBe(path.join(userRoot, 'widgets'));

    // Folder is claimed synchronously, before the clone resolves.
    expect((await stat(body.workDir)).isDirectory()).toBe(true);

    const terminal = await prog.terminal;
    expect(terminal.status).toBe('completed');
    expect(terminal.cloneId).toBe(String(body.cloneId));
    expect(terminal.projectName).toBe('widgets');
    expect(terminal.workDir).toBe(body.workDir);

    expect(audit).toContainEqual({
      userId: 'u1',
      action: 'project_create',
      path: 'widgets',
      bytes: 0,
    });
  });

  it('forwards git progress frames before the terminal frame', async () => {
    const prog = makeProgress();
    const { app } = buildApp(async (args: CloneRepoArgs) => {
      args.onProgress?.({ phase: 'Receiving objects', percent: 42 });
      return { ok: true };
    }, prog.notify);
    await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    await prog.terminal;
    expect(prog.messages).toContainEqual(
      expect.objectContaining({ phase: 'Receiving objects', percent: 42, status: 'cloning' }),
    );
  });

  it('rolls back the dir and reports clone_failed in the background', async () => {
    const prog = makeProgress();
    const { app } = buildApp(
      async () => ({ ok: false, kind: 'clone_failed', error: 'boom' }),
      prog.notify,
    );
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(201);

    const terminal = await prog.terminal;
    expect(terminal.status).toBe('failed');
    expect(terminal.errorCode).toBe('clone_failed');
    expect(await exists(path.join(userRoot, 'widgets'))).toBe(false);
  });

  it('rolls back the dir and reports clone_timeout in the background', async () => {
    const prog = makeProgress();
    const { app } = buildApp(
      async () => ({ ok: false, kind: 'clone_timeout', error: 't/o' }),
      prog.notify,
    );
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(201);

    const terminal = await prog.terminal;
    expect(terminal.status).toBe('failed');
    expect(terminal.errorCode).toBe('clone_timeout');
    expect(await exists(path.join(userRoot, 'widgets'))).toBe(false);
  });

  it('cancels an in-flight clone and reports clone_canceled', async () => {
    const prog = makeProgress();
    // A clone that only settles once its signal is aborted.
    const { app } = buildApp(
      (args: CloneRepoArgs) =>
        new Promise<CloneResult>((resolve) => {
          args.signal?.addEventListener('abort', () =>
            resolve({ ok: false, kind: 'clone_failed', error: 'aborted' }),
          );
        }),
      prog.notify,
    );
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;

    const cancel = await app.request(`/api/projects/${body.name}/clone`, { method: 'DELETE' });
    expect(cancel.status).toBe(200);

    const terminal = await prog.terminal;
    expect(terminal.status).toBe('failed');
    expect(terminal.errorCode).toBe('clone_canceled');
    expect(await exists(path.join(userRoot, 'widgets'))).toBe(false);
  });

  it('returns 404 cancelling when nothing is cloning', async () => {
    const { app } = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects/ghost/clone', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('uses an explicit slugified name over the derived one', async () => {
    const prog = makeProgress();
    const { app } = buildApp(async () => ({ ok: true }), prog.notify);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({}, 'Custom Name'),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;
    expect(body.name).toBe('custom-name');
    await prog.terminal;
  });

  it('forwards branch to cloneRepo when provided', async () => {
    const prog = makeProgress();
    let capturedArgs: CloneRepoArgs | undefined;
    const { app } = buildApp(async (args: CloneRepoArgs) => {
      capturedArgs = args;
      return { ok: true };
    }, prog.notify);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({ branch: 'develop' }),
    });
    expect(res.status).toBe(201);
    await prog.terminal;
    expect(capturedArgs?.branch).toBe('develop');
  });

  it('rejects an scp-style url with 400 invalid_url', async () => {
    const { app } = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({ url: 'git@github.com:acme/widgets.git' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_url' });
  });

  it('rejects an ssh:// url with 400 unsupported_scheme', async () => {
    const { app } = buildApp(async () => ({ ok: true }));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cloneBody({ url: 'ssh://git@h/o/r.git' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_scheme' });
  });
});

describe('POST /api/projects blank flow (no regression)', () => {
  it('creates a blank project without invoking cloneRepo', async () => {
    let cloneCalled = false;
    const { app } = buildApp(async () => {
      cloneCalled = true;
      return { ok: true };
    });
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ProjectCreateResponse;
    expect(body.name).toBe('hello-world');
    expect(body.status ?? 'ready').toBe('ready');
    expect(cloneCalled).toBe(false);

    const s = await stat(body.workDir);
    expect(s.isDirectory()).toBe(true);
  });
});
