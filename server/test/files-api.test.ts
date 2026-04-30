import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import type { AuthVariables } from '../src/auth/middleware';
import { type Env, loadEnv } from '../src/env';
import type { AuditEvent } from '../src/lib/logger';
import { createFilesRoutes } from '../src/routes/files';

// Mock auth — sets a fixed user; `requireAuth` middleware in the route
// factory passes through because user is non-null.
const mockUser = { id: 'u1', email: 'alice@example.com' };

function buildTestApp(testEnv: Env, auditCalls: AuditEvent[]) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: test fixture forces user shape
    c.set('user', mockUser as any);
    c.set('authSession', null);
    await next();
  });
  app.route(
    '/api/files',
    createFilesRoutes({
      env: testEnv,
      auditLog: (e) => {
        auditCalls.push(e);
      },
    }),
  );
  return app;
}

let tmpRoot: string;
let userRoot: string;
let testEnv: Env;
let auditCalls: AuditEvent[];
let app: Hono<{ Variables: AuthVariables }>;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'files-api-'));
  userRoot = path.join(tmpRoot, 'alice');
  await mkdir(userRoot, { recursive: true, mode: 0o700 });
  testEnv = loadEnv({ WORKSPACE_ROOT: tmpRoot, MAX_UPLOAD_BYTES: '1024' });
  auditCalls = [];
  app = buildTestApp(testEnv, auditCalls);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ─────────────────────────── /list ───────────────────────────

describe('GET /api/files/list', () => {
  it('returns entries with file / dir / other types', async () => {
    await writeFile(path.join(userRoot, 'a.txt'), 'hello');
    await mkdir(path.join(userRoot, 'sub'));
    // Symlink target is intentionally outside userRoot — `list` must classify
    // the symlink itself as 'other' without following it.
    await symlink(path.join(tmpRoot, 'nowhere'), path.join(userRoot, 'link'));

    const res = await app.request('/api/files/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ name: string; type: string }> };
    const byName = Object.fromEntries(body.entries.map((e) => [e.name, e.type]));
    expect(byName['a.txt']).toBe('file');
    expect(byName.sub).toBe('dir');
    expect(byName.link).toBe('other');
  });

  it('returns 404 when path does not exist', async () => {
    const res = await app.request('/api/files/list?path=does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 400 when path is a file', async () => {
    await writeFile(path.join(userRoot, 'plain.txt'), 'x');
    const res = await app.request('/api/files/list?path=plain.txt');
    expect(res.status).toBe(400);
  });

  it('returns 403 when path escapes user root', async () => {
    const res = await app.request(`/api/files/list?path=${encodeURIComponent('../etc')}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────── /read ───────────────────────────

describe('GET /api/files/read', () => {
  it('streams raw bytes with correct headers', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x42, 0x10]);
    await writeFile(path.join(userRoot, 'bin'), bytes);
    const res = await app.request('/api/files/read?path=bin');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-length')).toBe('4');
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(bytes));
  });

  it('returns 413 for files > 5 MiB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await writeFile(path.join(userRoot, 'huge.bin'), big);
    const res = await app.request('/api/files/read?path=huge.bin');
    expect(res.status).toBe(413);
  });

  it('returns 400 when path is a directory', async () => {
    await mkdir(path.join(userRoot, 'd'));
    const res = await app.request('/api/files/read?path=d');
    expect(res.status).toBe(400);
  });

  it('returns 404 when path does not exist', async () => {
    const res = await app.request('/api/files/read?path=missing.txt');
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────── /download ───────────────────────────

describe('GET /api/files/download', () => {
  it('sets ASCII Content-Disposition for plain filenames', async () => {
    await writeFile(path.join(userRoot, 'plain.txt'), 'abc');
    const res = await app.request('/api/files/download?path=plain.txt');
    expect(res.status).toBe(200);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('filename="plain.txt"');
    expect(cd).toContain("filename*=UTF-8''plain.txt");
  });

  it('emits both ASCII fallback + filename* for Unicode filenames', async () => {
    const name = 'tài liệu.txt';
    await writeFile(path.join(userRoot, name), 'content');
    const res = await app.request(`/api/files/download?path=${encodeURIComponent(name)}`);
    expect(res.status).toBe(200);
    const cd = res.headers.get('content-disposition') ?? '';
    // ASCII fallback: non-ASCII replaced with '_'
    expect(cd).toMatch(/filename="[^"]*_[^"]*"/);
    // RFC 5987 percent-encoded UTF-8 form is present
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
  });

  it('streams body bytes and audits with size', async () => {
    const payload = 'audit-me\n';
    await writeFile(path.join(userRoot, 'r.log'), payload);
    const res = await app.request('/api/files/download?path=r.log');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(payload);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      userId: 'u1',
      action: 'download',
      path: 'r.log',
      bytes: payload.length,
    });
  });
});

// ─────────────────────────── /upload ───────────────────────────

function multipartBody(parts: Array<{ name: string; value: string | Blob; filename?: string }>) {
  const fd = new FormData();
  for (const p of parts) {
    if (p.value instanceof Blob) {
      fd.append(p.name, p.value, p.filename ?? 'unnamed');
    } else {
      fd.append(p.name, p.value);
    }
  }
  return fd;
}

describe('POST /api/files/upload', () => {
  it('writes file with correct bytes, mode 0o600, and audits', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const fd = multipartBody([
      { name: 'path', value: 'sub/up.bin' },
      { name: 'file', value: new Blob([data]), filename: 'up.bin' },
    ]);
    const res = await app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { written: string; size: number };
    expect(body).toEqual({ written: 'sub/up.bin', size: 5 });

    const written = await readFile(path.join(userRoot, 'sub/up.bin'));
    expect(Array.from(written)).toEqual(Array.from(data));

    const st = await stat(path.join(userRoot, 'sub/up.bin'));
    expect(st.mode & 0o777).toBe(0o600);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      userId: 'u1',
      action: 'upload',
      path: 'sub/up.bin',
      bytes: 5,
    });
  });

  it('returns 413 and removes partial file when body exceeds cap', async () => {
    const big = new Uint8Array(2048); // 2 KB > 1024 cap
    big.fill(0x41);
    const fd = multipartBody([
      { name: 'path', value: 'big.bin' },
      { name: 'file', value: new Blob([big]), filename: 'big.bin' },
    ]);
    const res = await app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(413);
    await expect(stat(path.join(userRoot, 'big.bin'))).rejects.toThrow();
    expect(auditCalls).toHaveLength(0);
  });

  it('returns 400 when target path is an existing directory', async () => {
    await mkdir(path.join(userRoot, 'targetdir'));
    const fd = multipartBody([
      { name: 'path', value: 'targetdir' },
      { name: 'file', value: new Blob([new Uint8Array([1])]), filename: 'x' },
    ]);
    const res = await app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });

  it('returns 403 when path escapes user root', async () => {
    const fd = multipartBody([
      { name: 'path', value: '../escaped.bin' },
      { name: 'file', value: new Blob([new Uint8Array([1])]), filename: 'x' },
    ]);
    const res = await app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(403);
  });

  it('returns 400 when file part arrives before path field', async () => {
    const fd = multipartBody([
      { name: 'file', value: new Blob([new Uint8Array([1, 2, 3])]), filename: 'x.bin' },
      { name: 'path', value: 'x.bin' },
    ]);
    const res = await app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    // Nothing should have been written.
    await expect(stat(path.join(userRoot, 'x.bin'))).rejects.toThrow();
  });

  it('returns 400 when path field is missing entirely', async () => {
    const fd = multipartBody([
      { name: 'file', value: new Blob([new Uint8Array([1])]), filename: 'orphan.bin' },
    ]);
    const res = await app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });

  it('returns 400 when content-type is not multipart/form-data', async () => {
    const res = await app.request('/api/files/upload', {
      method: 'POST',
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.status).toBe(400);
  });
});
