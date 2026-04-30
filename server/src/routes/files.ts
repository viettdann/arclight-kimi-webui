import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { FileEntry, FileListResponse, FileUploadResponse } from 'shared/types';
import { type AuthVariables, requireAuth, sessionMiddleware } from '../auth/middleware';
import { env } from '../env';
import { resolveUserPath } from '../lib/path-guard';

const READ_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB cap on inline read.

const files = new Hono<{ Variables: AuthVariables }>();

files.use('*', sessionMiddleware);
files.use('*', requireAuth);

interface UserCtx {
  userId: string;
  userRoot: string;
}

async function userCtx(email: string | null | undefined, userId: string): Promise<UserCtx> {
  const username = (email ?? '').split('@')[0] ?? '';
  const userRoot = path.join(env.WORKSPACE_ROOT, username);
  // Ensure user root exists. The auth `onCreateUser` hook also does this; the
  // mkdir here is idempotent and protects against missed/cleared dirs.
  await mkdir(userRoot, { recursive: true, mode: 0o700 });
  return { userId, userRoot };
}

function logAudit(userId: string, action: string, p: string, bytes: number): void {
  // Per design §"Audit": stdout JSON for upload/download.
  console.log(JSON.stringify({ userId, action, path: p, bytes }));
}

files.get('/list', async (c) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  const rel = c.req.query('path') ?? '';
  const ctx = await userCtx(user.email, user.id);

  let abs: string;
  try {
    abs = await resolveUserPath(ctx.userRoot, rel);
  } catch {
    return c.json({ error: 'forbidden' }, 403);
  }

  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: FileEntry[] = await Promise.all(
    dirents.map(async (d): Promise<FileEntry> => {
      const full = path.join(abs, d.name);
      const s = await stat(full);
      return {
        name: d.name,
        type: d.isDirectory() ? 'dir' : 'file',
        size: s.size,
        mtime: s.mtimeMs,
      };
    }),
  );
  const body: FileListResponse = { entries };
  return c.json(body);
});

files.get('/read', async (c) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  const rel = c.req.query('path') ?? '';
  const ctx = await userCtx(user.email, user.id);

  let abs: string;
  try {
    abs = await resolveUserPath(ctx.userRoot, rel);
  } catch {
    return c.json({ error: 'forbidden' }, 403);
  }

  const s = await stat(abs);
  if (!s.isFile()) return c.json({ error: 'not_a_file' }, 400);
  if (s.size > READ_MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413);

  const buf = await readFile(abs);
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
});

files.get('/download', async (c) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  const rel = c.req.query('path') ?? '';
  const ctx = await userCtx(user.email, user.id);

  let abs: string;
  try {
    abs = await resolveUserPath(ctx.userRoot, rel);
  } catch {
    return c.json({ error: 'forbidden' }, 403);
  }

  const s = await stat(abs);
  if (!s.isFile()) return c.json({ error: 'not_a_file' }, 400);

  logAudit(ctx.userId, 'download', rel, s.size);

  const file = Bun.file(abs);
  const filename = path.basename(abs).replace(/"/g, '');
  return new Response(file.stream(), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(s.size),
    },
  });
});

files.post('/upload', async (c) => {
  const user = c.var.user;
  if (user == null) return c.json({ error: 'unauthorized' }, 401);
  const ctx = await userCtx(user.email, user.id);

  const form = await c.req.formData();
  const rel = form.get('path');
  const fileField = form.get('file');
  if (typeof rel !== 'string' || !(fileField instanceof File)) {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (fileField.size > env.MAX_UPLOAD_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }

  let abs: string;
  try {
    abs = await resolveUserPath(ctx.userRoot, rel);
  } catch {
    return c.json({ error: 'forbidden' }, 403);
  }

  await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(await fileField.arrayBuffer());
  await writeFile(abs, bytes, { mode: 0o600 });

  logAudit(ctx.userId, 'upload', rel, bytes.byteLength);

  const body: FileUploadResponse = { written: rel, size: bytes.byteLength };
  return c.json(body);
});

export default files;
