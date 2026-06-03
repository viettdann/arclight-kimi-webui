import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type {
  GitBranchResponse,
  GitCommandRequest,
  GitCommandResponse,
  GitLogResponse,
  GitStatusResponse,
} from 'shared/types/git-credentials';
import { GIT_ERROR_NOT_REPO, isGitProvider } from 'shared/types/git-credentials';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb, schema } from '../db';
import { env as defaultEnv, type Env } from '../env';
import { resolveUserPath } from '../lib/path-guard';
import {
  executeGitCommand,
  getDetailedLog,
  getRemoteUrl,
  isRemoteCommand,
  parseBranches,
  parseStatus,
} from '../services/git/commands';
import { inferProvider } from '../services/git/url';
import * as credentialRepo from '../services/git-credentials/repo';

export interface GitRouterDeps {
  db?: DB;
  env?: Pick<Env, 'WORKSPACE_ROOT'>;
}

export function createGitRouter(deps: GitRouterDeps = {}): Hono<{ Variables: AuthVariables }> {
  const db = deps.db ?? defaultDb;
  const env = deps.env ?? defaultEnv;

  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // Cache mkdir per userRoot so we don't syscall on every request.
  const ensuredRoots = new Set<string>();

  // Resolve user workspace dir for a project name.
  async function resolveWorkDir(
    email: string | null | undefined,
    projectName: string,
  ): Promise<string> {
    const userRoot = path.join(env.WORKSPACE_ROOT, slug(email ?? ''));
    if (!ensuredRoots.has(userRoot)) {
      await mkdir(userRoot, { recursive: true, mode: 0o700 });
      ensuredRoots.add(userRoot);
    }
    return resolveUserPath(userRoot, projectName);
  }

  // Credential resolver for the commands service.
  const credentialResolver = {
    getOwned: async (userId: string, credentialId: string) => {
      const row = await credentialRepo.getOwned(db, userId, credentialId);
      if (!row) return null;
      return { provider: row.provider, token: row.token };
    },
  };

  // ─────────────────────────── GET /status ───────────────────────────

  router.get('/status', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const projectName = c.req.query('projectName');
    if (!projectName) return c.json({ error: 'projectName required' }, 400);

    let workDir: string;
    try {
      workDir = await resolveWorkDir(user.email, projectName);
    } catch {
      return c.json({ error: 'forbidden' }, 403);
    }

    const raw = await executeGitCommand({ command: 'status', cwd: workDir });
    if (raw.exitCode !== 0 && raw.stderr.includes('not a git repository')) {
      return c.json({ error: GIT_ERROR_NOT_REPO }, 404);
    }

    const status: GitStatusResponse = parseStatus(raw);
    return c.json(status);
  });

  // ─────────────────────────── GET /log ───────────────────────────

  router.get('/log', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const projectName = c.req.query('projectName');
    if (!projectName) return c.json({ error: 'projectName required' }, 400);

    let workDir: string;
    try {
      workDir = await resolveWorkDir(user.email, projectName);
    } catch {
      return c.json({ error: 'forbidden' }, 403);
    }

    const log = await getDetailedLog(workDir);
    return c.json(log satisfies GitLogResponse);
  });

  // ─────────────────────────── GET /diff ───────────────────────────

  router.get('/diff', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const projectName = c.req.query('projectName');
    if (!projectName) return c.json({ error: 'projectName required' }, 400);

    const filePath = c.req.query('path');
    const staged = c.req.query('staged') === 'true';

    let workDir: string;
    try {
      workDir = await resolveWorkDir(user.email, projectName);
    } catch {
      return c.json({ error: 'forbidden' }, 403);
    }

    const args: string[] = [];
    if (staged) args.push('--staged');
    if (filePath) {
      args.push('--', filePath);
    }

    const raw = await executeGitCommand({ command: 'diff', args, cwd: workDir });
    return c.json(raw satisfies GitCommandResponse);
  });

  // ─────────────────────────── GET /branches ───────────────────────────

  router.get('/branches', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    const projectName = c.req.query('projectName');
    if (!projectName) return c.json({ error: 'projectName required' }, 400);

    let workDir: string;
    try {
      workDir = await resolveWorkDir(user.email, projectName);
    } catch {
      return c.json({ error: 'forbidden' }, 403);
    }

    const raw = await executeGitCommand({ command: 'branch', cwd: workDir });
    if (raw.exitCode !== 0) {
      return c.json({ error: GIT_ERROR_NOT_REPO }, 404);
    }

    const branches: GitBranchResponse = parseBranches(raw);
    return c.json(branches);
  });

  // ─────────────────────────── POST /command ───────────────────────────

  router.post('/command', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    let body: GitCommandRequest;
    try {
      body = (await c.req.json()) as GitCommandRequest;
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }

    if (!body.projectName || typeof body.projectName !== 'string') {
      return c.json({ error: 'projectName required' }, 400);
    }

    // Validate inline credential fields
    if (body.inlineToken) {
      if (!body.provider || !isGitProvider(body.provider)) {
        return c.json({ error: 'provider required with inlineToken' }, 400);
      }
    }

    let workDir: string;
    try {
      workDir = await resolveWorkDir(user.email, body.projectName);
    } catch {
      return c.json({ error: 'forbidden' }, 403);
    }

    // Auto-inject credentialId from project metadata for remote commands
    // when the client didn't supply one explicitly.
    let resolvedCredentialId = body.credentialId;
    if (isRemoteCommand(body.command) && !resolvedCredentialId && !body.inlineToken) {
      const metaRows = await db
        .select({ credentialId: schema.projectGitMetadata.credentialId })
        .from(schema.projectGitMetadata)
        .where(
          and(
            eq(schema.projectGitMetadata.userId, user.id),
            eq(schema.projectGitMetadata.projectName, body.projectName),
          ),
        )
        .limit(1);
      if (metaRows[0]?.credentialId) {
        resolvedCredentialId = metaRows[0].credentialId;
      }
    }

    const result = await executeGitCommand(
      {
        command: body.command,
        args: body.args,
        cwd: workDir,
        credentialId: resolvedCredentialId,
        inlineToken: body.inlineToken,
        provider: body.provider,
      },
      credentialResolver,
      user.id,
    );

    return c.json(result satisfies GitCommandResponse);
  });

  // ─────────────────────────── PUT /link-credential ───────────────────────────

  router.put('/link-credential', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);

    let body: { projectName?: string; credentialId?: string | null };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }

    if (!body.projectName || typeof body.projectName !== 'string') {
      return c.json({ error: 'projectName required' }, 400);
    }

    const credentialId = body.credentialId ?? null;

    // Verify ownership before linking: a foreign/invalid id must not slip past
    // the FK (and must never let a user point at someone else's credential).
    if (credentialId) {
      const owned = await credentialRepo.getOwned(db, user.id, credentialId);
      if (!owned) return c.json({ error: 'credential_not_found' }, 400);
    }

    const where = and(
      eq(schema.projectGitMetadata.userId, user.id),
      eq(schema.projectGitMetadata.projectName, body.projectName),
    );

    // UPSERT: a project may have no metadata row yet (blank or adopted project),
    // so linking must create one — not 404. The row persists the choice so
    // later pull/fetch auto-inject the credential without re-prompting.
    const updated = await db
      .update(schema.projectGitMetadata)
      .set({ credentialId })
      .where(where)
      .returning({ projectName: schema.projectGitMetadata.projectName });

    if (updated.length > 0) return c.json({ ok: true });

    // No row yet — insert one, backfilling remote URL + provider from the local
    // repo when possible so reclone/auto-inject have what they need.
    let remoteUrl: string | null = null;
    let provider: string | null = null;
    try {
      const workDir = await resolveWorkDir(user.email, body.projectName);
      remoteUrl = await getRemoteUrl(workDir);
      if (remoteUrl) provider = inferProvider(remoteUrl);
    } catch {
      // Not a local repo / can't resolve — store credentialId alone.
    }

    await db.insert(schema.projectGitMetadata).values({
      userId: user.id,
      projectName: body.projectName,
      remoteUrl,
      provider,
      defaultBranch: null,
      credentialId,
    });

    return c.json({ ok: true });
  });

  return router;
}
