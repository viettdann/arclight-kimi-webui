import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import type { GitCredentialDTO, GitCredentialListResponse } from 'shared/types/git-credentials';
import type { AuthVariables } from '../../src/auth/middleware';
import { createGitCredentialsRouter } from '../../src/routes/git-credentials';
import { makeFakeDb } from '../_helpers';

type TestRemoteStub = (args: {
  url: string;
  provider: string;
  token: string;
  username?: string;
  timeoutMs: number;
}) => Promise<{ ok: boolean; error?: string }>;

function buildApp(
  fake: ReturnType<typeof makeFakeDb>,
  testRemote: TestRemoteStub,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 'u1', email: 'a@x.com' } as never);
    c.set('authSession', null);
    await next();
  });
  app.route(
    '/api/git-credentials',
    createGitCredentialsRouter({
      db: fake.db,
      env: { GIT_CLONE_TIMEOUT_MS: 1000 },
      testRemote: testRemote as never,
    }),
  );
  return app;
}

const okStub: TestRemoteStub = async () => ({ ok: true });

function ownedRow(token: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
    userId: 'u1',
    label: 'L',
    provider: 'github',
    token,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('POST /api/git-credentials', () => {
  it('creates a credential and returns masked token without plaintext', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'L', provider: 'github', token: 'secret-1234' }),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('secret-1234');
    const body = JSON.parse(text) as GitCredentialDTO;
    expect(body.tokenMask).toBe('***1234');
    expect((body as unknown as { token?: string }).token).toBeUndefined();
  });

  it('rejects a missing/invalid provider with 400', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'L', provider: 'gitlab', token: 'secret-1234' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_provider' });
  });

  it('rejects a missing token with 400', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'L', provider: 'github' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
  });
});

describe('GET /api/git-credentials', () => {
  it('lists credentials with masked tokens and no plaintext', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([ownedRow('secret-1234')]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('secret-1234');
    const body = JSON.parse(text) as GitCredentialListResponse;
    expect(body.credentials[0]?.tokenMask).toBe('***1234');
    expect((body.credentials[0] as unknown as { token?: string }).token).toBeUndefined();
  });
});

describe('PATCH /api/git-credentials/:id', () => {
  it('keeps the old token when patching without a token', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([ownedRow('old-token-abcd')]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials/c1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'new' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GitCredentialDTO;
    expect(body.tokenMask).toBe('***abcd');
    expect(body.label).toBe('new');
  });

  it('replaces the token when a new token is supplied', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([ownedRow('old-token-abcd')]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials/c1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'brand-new-9999' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GitCredentialDTO;
    expect(body.tokenMask).toBe('***9999');
  });

  it('returns 404 when the credential is not owned', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials/c1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'new' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('DELETE /api/git-credentials/:id', () => {
  it('deletes an owned credential and records a delete op', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([ownedRow('secret-1234')]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials/c1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fake.calls.some((call) => call.op === 'delete')).toBe(true);
  });

  it('returns 404 when the credential is not owned', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials/c1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('POST /api/git-credentials/test', () => {
  it('returns ok:true when the remote check succeeds (inline token)', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, async () => ({ ok: true }));
    const res = await app.request('/api/git-credentials/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/org/repo.git',
        inlineToken: 'tok',
        provider: 'github',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('passes through ok:false + error from the remote check', async () => {
    const fake = makeFakeDb();
    const app = buildApp(fake, async () => ({ ok: false, error: 'bad' }));
    const res = await app.request('/api/git-credentials/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://github.com/org/repo.git',
        inlineToken: 'tok',
        provider: 'github',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'bad' });
  });

  it('returns credential_not_found when the credentialId is unknown', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([]);
    const app = buildApp(fake, okStub);
    const res = await app.request('/api/git-credentials/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/org/repo.git', credentialId: 'nope' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'credential_not_found' });
  });
});
