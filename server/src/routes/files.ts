import { chmod, lstat, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import busboyLib from 'busboy';
import { Hono } from 'hono';
import type { FileEntry, FileListResponse, FileUploadResponse } from 'shared/types';
import { slug } from '../auth';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { env as defaultEnv, type Env } from '../env';
import { auditLog as defaultAuditLog } from '../lib/logger';
import { resolveUserPath } from '../lib/path-guard';

// 5 MiB cap on inline reads (`GET /read`). Larger files must use `/download`.
const READ_MAX_BYTES = 5 * 1024 * 1024;

export interface FilesRoutesDeps {
  env: Pick<Env, 'WORKSPACE_ROOT' | 'MAX_UPLOAD_BYTES'>;
  auditLog: typeof defaultAuditLog;
}

interface UserCtx {
  userId: string;
  userRoot: string;
}

export function createFilesRoutes(deps: FilesRoutesDeps): Hono<{ Variables: AuthVariables }> {
  const { env, auditLog } = deps;

  const files = new Hono<{ Variables: AuthVariables }>();
  files.use('*', requireAuth);

  async function userCtx(email: string | null | undefined, userId: string): Promise<UserCtx> {
    // Use canonical slug() so the dir matches what auth `databaseHooks.user.create.after`
    // created at sign-up. A naive `email.split('@')[0]` would diverge for emails
    // containing uppercase or special chars.
    const userRoot = path.join(env.WORKSPACE_ROOT, slug(email ?? ''));
    // Idempotent — the auth `onCreateUser` hook also creates this dir.
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    return { userId, userRoot };
  }

  // ─────────────────────────── GET /list ───────────────────────────

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

    let dirStat: Awaited<ReturnType<typeof stat>>;
    try {
      dirStat = await stat(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: 'not_found' }, 404);
      }
      throw err;
    }
    if (!dirStat.isDirectory()) {
      return c.json({ error: 'not_a_directory' }, 400);
    }

    const dirents = await readdir(abs, { withFileTypes: true });
    const entries: FileEntry[] = await Promise.all(
      dirents.map(async (d): Promise<FileEntry> => {
        const full = path.join(abs, d.name);
        // `lstat` keeps symlink/socket/fifo classification accurate; we don't
        // want to silently follow links into 'file'/'dir'.
        const s = await lstat(full);
        let type: FileEntry['type'];
        if (d.isFile()) type = 'file';
        else if (d.isDirectory()) type = 'dir';
        else type = 'other';
        return {
          name: d.name,
          type,
          size: s.size,
          mtime: s.mtimeMs,
        };
      }),
    );
    const body: FileListResponse = { entries };
    return c.json(body);
  });

  // ─────────────────────────── GET /read ───────────────────────────

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

    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: 'not_found' }, 404);
      }
      throw err;
    }
    if (s.isDirectory()) return c.json({ error: 'not_a_file' }, 400);
    if (!s.isFile()) return c.json({ error: 'not_a_file' }, 400);
    if (s.size > READ_MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413);

    const file = Bun.file(abs);
    return new Response(file.stream(), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(s.size),
      },
    });
  });

  // ─────────────────────────── GET /download ───────────────────────────

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

    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: 'not_found' }, 404);
      }
      throw err;
    }
    if (s.isDirectory()) return c.json({ error: 'not_a_file' }, 400);
    if (!s.isFile()) return c.json({ error: 'not_a_file' }, 400);

    // RFC 5987: filename for ASCII-fallback, filename* for UTF-8.
    const basename = path.basename(abs);
    const asciiFallback = basename.replace(/[\r\n"]/g, '').replace(/[^\x20-\x7e]/g, '_');
    const disposition =
      `attachment; filename="${asciiFallback}"; ` +
      `filename*=UTF-8''${encodeURIComponent(basename)}`;

    // Audit before returning the streamed body. There is no clean "response
    // sent" hook in Hono/Bun, and `s.size` is already known via stat — if the
    // client aborts mid-stream, the audit still reflects the intent + size.
    auditLog({ userId: ctx.userId, action: 'download', path: rel, bytes: s.size });

    const file = Bun.file(abs);
    return new Response(file.stream(), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(s.size),
        'Content-Disposition': disposition,
      },
    });
  });

  // ─────────────────────────── POST /upload ───────────────────────────

  files.post('/upload', async (c) => {
    const user = c.var.user;
    if (user == null) return c.json({ error: 'unauthorized' }, 401);
    const ctx = await userCtx(user.email, user.id);

    const ct = c.req.header('content-type');
    if (!ct?.toLowerCase().startsWith('multipart/form-data')) {
      return c.json({ error: 'bad_request' }, 400);
    }

    const body = c.req.raw.body;
    if (body == null) return c.json({ error: 'bad_request' }, 400);

    const bb = busboyLib({
      headers: { 'content-type': ct },
      limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5 },
    });

    let pathRel: string | null = null;
    let fileSeen = false;
    let responded = false;
    let resolveResponse!: (r: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const respondOnce = (r: Response): void => {
      if (responded) return;
      responded = true;
      resolveResponse(r);
    };

    bb.on('field', (name, val) => {
      if (name === 'path' && pathRel === null) {
        pathRel = val;
      }
    });

    bb.on('file', (_name, fileStream, _info) => {
      fileSeen = true;
      // Silence error emission from the file stream itself — busboy's internal
      // teardown can emit synthetic errors when the parser is closed mid-part.
      // We don't want those propagating as unhandled.
      fileStream.on('error', () => {});

      // Capture path snapshot synchronously — by the time the async work below
      // runs, more 'field' events may have fired and mutated `pathRel`.
      const rel = pathRel;
      if (rel === null) {
        // Field-order convention violated. Drain (don't destroy busboy — that
        // can crash the parser with "Unexpected end of file") and respond.
        fileStream.resume();
        respondOnce(c.json({ error: 'bad_request' }, 400));
        return;
      }

      void (async () => {
        let abs: string;
        try {
          abs = await resolveUserPath(ctx.userRoot, rel);
        } catch {
          fileStream.resume();
          respondOnce(c.json({ error: 'forbidden' }, 403));
          return;
        }

        // Reject upload onto an existing directory before opening the writer.
        try {
          const existing = await stat(abs);
          if (existing.isDirectory()) {
            fileStream.resume();
            respondOnce(c.json({ error: 'not_a_file' }, 400));
            return;
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            fileStream.resume();
            respondOnce(c.json({ error: 'server_error' }, 500));
            return;
          }
        }

        await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });

        const writer = Bun.file(abs).writer();
        let bytes = 0;
        let limited = false;
        fileStream.on('limit', () => {
          limited = true;
        });

        try {
          for await (const chunk of fileStream as AsyncIterable<Buffer>) {
            writer.write(chunk);
            bytes += chunk.length;
          }
          // Flush + close fd. Must happen BEFORE unlink to avoid fd leaks.
          await writer.end();
        } catch {
          try {
            await writer.end();
          } catch {
            // ignore
          }
          await unlink(abs).catch(() => {});
          respondOnce(c.json({ error: 'server_error' }, 500));
          return;
        }

        if (limited || (fileStream as { truncated?: boolean }).truncated) {
          await unlink(abs).catch(() => {});
          respondOnce(c.json({ error: 'payload_too_large' }, 413));
          return;
        }

        // Bun 1.3.13 FileSink doesn't accept a mode argument — chmod after
        // end. Race window is bounded by parent dir mode 0o700 (set above
        // and by auth onCreateUser), so no other user can stat in between.
        await chmod(abs, 0o600);
        auditLog({ userId: ctx.userId, action: 'upload', path: rel, bytes });

        const okBody: FileUploadResponse = { written: rel, size: bytes };
        respondOnce(c.json(okBody));
      })();
    });

    bb.on('error', () => {
      respondOnce(c.json({ error: 'bad_request' }, 400));
    });

    bb.on('close', () => {
      // Parser closed without ever firing 'file' → missing required `file`
      // part. If `file` did fire, the async writer below is in charge of the
      // response (or has already responded), so we leave `responded` to it.
      if (!fileSeen) {
        respondOnce(c.json({ error: 'bad_request' }, 400));
      }
    });

    Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>).pipe(bb);

    return responsePromise;
  });

  return files;
}

// Default export wires production env + audit logger. Tests build their own
// instance via `createFilesRoutes(...)` with an injected env and audit sink.
export default createFilesRoutes({ env: defaultEnv, auditLog: defaultAuditLog });
