import { Hono } from 'hono';
import type { SkillUploadError, SkillUploadResponse } from 'shared/types';
import { type AuthVariables, requireAuth } from '../auth/middleware';
import { type DB, db as defaultDb } from '../db';
import { env } from '../env';
import { syncSkillsForUser } from '../services/agent/skill-sync';
import type { SessionManager } from '../services/session-manager';
import { sessionManager } from '../services/session-manager';
import {
  type DetectedSkill,
  detectSkills,
  normalizeArchive,
  type SkillFile,
  unzip,
} from '../services/skills/extract';
import { isJunkPath } from '../services/skills/junk';
import { deleteSkill, listSkills, setEnabled, toDTO, upsertSkill } from '../services/skills/store';

export interface MeSkillsRouterDeps {
  db: DB;
  manager: SessionManager;
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A non-UUID `:id` can never identify a row; treat it as not-found rather than
// letting Postgres throw `invalid input syntax for type uuid`.
const isUuid = (id: string): boolean => UUID_RE.test(id);

export function createMeSkillsRouter(deps: MeSkillsRouterDeps): Hono<{ Variables: AuthVariables }> {
  const { db, manager } = deps;
  const router = new Hono<{ Variables: AuthVariables }>();
  router.use('*', requireAuth);

  // Push a skill change into the user's live sessions (catalog refresh + dispose
  // idle subprocesses so the next turn reloads skills). Fire-and-forget: never
  // block or fail the HTTP write on it.
  const syncSessions = (userId: string): void => {
    void syncSkillsForUser(manager, db, userId);
  };

  // ─────────────────────────── GET / ───────────────────────────

  router.get('/', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const rows = await listSkills(db, user.id);
    return c.json({ skills: rows.map(toDTO) });
  });

  // ─────────────────────────── POST /upload ───────────────────────────

  router.post('/upload', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const ct = c.req.header('content-type');
    if (!ct?.toLowerCase().startsWith('multipart/form-data')) {
      return c.json({ error: 'bad_request' }, 400);
    }
    // `c.req.formData()` buffers the whole body, so bound it before reading.
    // A present Content-Length is mutually exclusive with chunked encoding, so
    // requiring it (and capping it) bounds how many body bytes we ever read;
    // rejecting its absence closes the unbounded chunked-upload path.
    const lenHeader = c.req.header('content-length');
    const declaredLen = lenHeader === undefined ? Number.NaN : Number(lenHeader);
    if (!Number.isFinite(declaredLen)) return c.json({ error: 'length_required' }, 411);
    if (declaredLen > env.MAX_UPLOAD_BYTES) return c.json({ error: 'payload_too_large' }, 413);

    const form = await c.req.formData();
    const files = form.getAll('files');
    const rawPaths = form.getAll('paths');

    if (files.length === 0) return c.json({ error: 'no_files' }, 400);
    // Every `files` entry must be a File; every `paths` entry a string. A File
    // in a `paths` slot (or vice-versa) means a malformed/tampered payload.
    if (!files.every((f): f is File => f instanceof File)) {
      return c.json({ error: 'bad_request' }, 400);
    }
    if (!rawPaths.every((p): p is string => typeof p === 'string')) {
      return c.json({ error: 'bad_request' }, 400);
    }
    // Multipart serialization strips webkitRelativePath, so `paths` is the only
    // source of folder structure. A length mismatch means a stale client bundle.
    if (rawPaths.length !== files.length) {
      return c.json({ error: 'payload malformed, refresh and retry' }, 400);
    }
    // Traversal guard before any processing.
    for (const p of rawPaths) {
      if (p.startsWith('/') || p.split('/').includes('..')) {
        return c.json({ error: 'invalid file path' }, 400);
      }
    }

    const getPath = (i: number): string => rawPaths[i] || files[i]?.name || '';

    const created: string[] = [];
    const updated: string[] = [];
    const errors: SkillUploadError[] = [];
    const detected: DetectedSkill[] = [];

    // Detect (don't yet save): each scope contributes skills + recoverable
    // errors. Saving is deferred so a name collision *across* scopes can be
    // rejected rather than silently overwriting.
    const processScope = (scopeFiles: SkillFile[], label?: string): void => {
      const { skills, errors: detErrors } = detectSkills(scopeFiles);
      detected.push(...skills);
      for (const er of detErrors) errors.push({ name: er.name ?? label, message: er.message });
    };

    // Bucket entries into scopes: each standalone .md is its own scope; each
    // .zip/.skill unzips to its own scope; all folder entries form one scope.
    const folderFiles: SkillFile[] = [];
    for (const [i, file] of files.entries()) {
      const relPath = getPath(i);
      if (isJunkPath(relPath)) continue;

      // detectType: folder first, else by extension.
      if (relPath.includes('/')) {
        folderFiles.push({ path: relPath, bytes: new Uint8Array(await file.arrayBuffer()) });
        continue;
      }

      const ext = extOf(file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ext === 'zip' || ext === 'skill') {
        let entries: SkillFile[];
        try {
          entries = unzip(bytes);
        } catch (err) {
          errors.push({ name: file.name, message: errMsg(err) });
          continue;
        }
        processScope(entries, file.name);
      } else if (ext === 'md') {
        // A directly-picked *.md (any basename) is this skill's SKILL.md.
        processScope([{ path: 'SKILL.md', bytes }], file.name);
      }
      // Unsupported top-level files are not skills — ignored.
    }

    if (folderFiles.length > 0) processScope(folderFiles);

    // Intra-submit name collision (#19): a name resolved by more than one
    // detected skill is rejected (reported once) rather than silently
    // overwritten; uniquely-named skills still save.
    const nameCounts = new Map<string, number>();
    for (const d of detected) nameCounts.set(d.name, (nameCounts.get(d.name) ?? 0) + 1);
    const reportedCollision = new Set<string>();
    for (const d of detected) {
      if ((nameCounts.get(d.name) ?? 0) > 1) {
        if (!reportedCollision.has(d.name)) {
          errors.push({ name: d.name, message: `multiple uploaded skills resolve to "${d.name}"` });
          reportedCollision.add(d.name);
        }
        continue;
      }
      try {
        const norm = normalizeArchive(d);
        const res = await upsertSkill(db, user.id, {
          name: d.name,
          description: d.description,
          archive: norm.archive,
          sizeBytes: norm.sizeBytes,
          fileCount: norm.fileCount,
        });
        (res.action === 'created' ? created : updated).push(d.name);
      } catch (err) {
        errors.push({ name: d.name, message: errMsg(err) });
      }
    }

    if (created.length > 0 || updated.length > 0) syncSessions(user.id);

    const body: SkillUploadResponse = { created, updated, errors };
    return c.json(body);
  });

  // ─────────────────────────── PATCH /:id ───────────────────────────

  router.patch('/:id', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    const enabled = (payload as { enabled?: unknown } | null)?.enabled;
    if (typeof enabled !== 'boolean') return c.json({ error: 'bad_request' }, 400);

    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const ok = await setEnabled(db, user.id, id, enabled);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    syncSessions(user.id);
    return c.json({ ok: true });
  });

  // ─────────────────────────── DELETE /:id ───────────────────────────

  router.delete('/:id', async (c) => {
    const user = c.var.user;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const ok = await deleteSkill(db, user.id, id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    syncSessions(user.id);
    return c.json({ ok: true });
  });

  return router;
}

export default createMeSkillsRouter({ db: defaultDb, manager: sessionManager });
