import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { DB } from '../../src/db';
import { normalizeArchive } from '../../src/services/skills/extract';
import { restoreSkillsForUser } from '../../src/services/skills/restore';
import {
  deleteSkill,
  listEnabledSkillMeta,
  listSkills,
  setEnabled,
  toDTO,
  upsertSkill,
} from '../../src/services/skills/store';
import { makePgDb, type PgHandle } from '../_helpers-pg';

// Real in-process Postgres (pglite). The full migration set applies cleanly, so
// the `skills` table (incl. the bytea `archive` column) exists. store functions
// are typed for the postgres-js DB; the pglite drizzle handle is API-compatible
// at runtime, so we cast for the call sites.
let handle: PgHandle;
let db: DB;
const USER = 'user-1';

function archiveFor(name: string, body = 'Body text.'): ReturnType<typeof normalizeArchive> {
  return normalizeArchive({
    name,
    description: '',
    files: [
      { path: 'SKILL.md', bytes: new TextEncoder().encode(`---\nname: ${name}\n---\n${body}\n`) },
    ],
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  handle = await makePgDb();
  db = handle.db as unknown as DB;
  await db.execute(
    sql`INSERT INTO "user"(id, name, email) VALUES(${USER}, 'U1', 'u1@example.com')`,
  );
});

afterEach(async () => {
  await handle?.close();
});

describe('skills store', () => {
  test('upsert creates then updates, preserving enabled', async () => {
    const a1 = archiveFor('alpha', 'one');
    const r1 = await upsertSkill(db, USER, {
      name: 'alpha',
      description: 'first',
      archive: a1.archive,
      sizeBytes: a1.sizeBytes,
      fileCount: a1.fileCount,
    });
    expect(r1.action).toBe('created');

    let rows = await listSkills(db, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);

    // Disable, then re-upload the same name: enabled must stay false.
    await setEnabled(db, USER, rows[0]!.id, false);
    const a2 = archiveFor('alpha', 'two');
    const r2 = await upsertSkill(db, USER, {
      name: 'alpha',
      description: 'second',
      archive: a2.archive,
      sizeBytes: a2.sizeBytes,
      fileCount: a2.fileCount,
    });
    expect(r2.action).toBe('updated');

    rows = await listSkills(db, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.description).toBe('second');
  });

  test('listSkills is owner-scoped and ordered by name', async () => {
    await db.execute(
      sql`INSERT INTO "user"(id, name, email) VALUES('user-2', 'U2', 'u2@example.com')`,
    );
    for (const n of ['gamma', 'alpha', 'beta']) {
      const a = archiveFor(n);
      await upsertSkill(db, USER, {
        name: n,
        description: '',
        archive: a.archive,
        sizeBytes: a.sizeBytes,
        fileCount: a.fileCount,
      });
    }
    const otherArchive = archiveFor('zeta');
    await upsertSkill(db, 'user-2', {
      name: 'zeta',
      description: '',
      archive: otherArchive.archive,
      sizeBytes: otherArchive.sizeBytes,
      fileCount: otherArchive.fileCount,
    });

    const rows = await listSkills(db, USER);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('listEnabledSkillMeta excludes disabled rows and omits the archive blob', async () => {
    for (const n of ['on1', 'off1', 'on2']) {
      const a = archiveFor(n);
      await upsertSkill(db, USER, {
        name: n,
        description: '',
        archive: a.archive,
        sizeBytes: a.sizeBytes,
        fileCount: a.fileCount,
      });
    }
    const all = await listSkills(db, USER);
    const off = all.find((r) => r.name === 'off1');
    await setEnabled(db, USER, off!.id, false);

    const enabled = await listEnabledSkillMeta(db, USER);
    expect(enabled.map((r) => r.name).sort()).toEqual(['on1', 'on2']);
    expect(enabled[0]).not.toHaveProperty('archive');
  });

  test('setEnabled / deleteSkill are owner-scoped (false for foreign or missing rows)', async () => {
    const a = archiveFor('owned');
    await upsertSkill(db, USER, {
      name: 'owned',
      description: '',
      archive: a.archive,
      sizeBytes: a.sizeBytes,
      fileCount: a.fileCount,
    });
    const row = (await listSkills(db, USER))[0]!;

    // Wrong owner → no-op.
    expect(await setEnabled(db, 'someone-else', row.id, false)).toBe(false);
    expect(await deleteSkill(db, 'someone-else', row.id)).toBe(false);
    expect(await listSkills(db, USER)).toHaveLength(1);

    // Right owner → deletes.
    expect(await deleteSkill(db, USER, row.id)).toBe(true);
    expect(await listSkills(db, USER)).toHaveLength(0);
  });

  test('toDTO omits the archive blob', async () => {
    const a = archiveFor('dto');
    await upsertSkill(db, USER, {
      name: 'dto',
      description: 'desc',
      archive: a.archive,
      sizeBytes: a.sizeBytes,
      fileCount: a.fileCount,
    });
    const dto = toDTO((await listSkills(db, USER))[0]!);
    expect(dto).not.toHaveProperty('archive');
    expect(dto.name).toBe('dto');
    expect(dto.enabled).toBe(true);
    expect(typeof dto.createdAt).toBe('string');
  });

  test('restoreSkillsForUser materializes enabled skills and skips disabled', async () => {
    for (const n of ['live', 'dead']) {
      const a = archiveFor(n);
      await upsertSkill(db, USER, {
        name: n,
        description: '',
        archive: a.archive,
        sizeBytes: a.sizeBytes,
        fileCount: a.fileCount,
      });
    }
    const dead = (await listSkills(db, USER)).find((r) => r.name === 'dead')!;
    await setEnabled(db, USER, dead.id, false);

    const configDir = await mkdtemp(join(tmpdir(), 'skills-cfg-'));
    try {
      await restoreSkillsForUser(db, USER, configDir);
      expect(await exists(join(configDir, 'skills', 'live', 'SKILL.md'))).toBe(true);
      expect(await exists(join(configDir, 'skills', 'dead'))).toBe(false);
      const md = await readFile(join(configDir, 'skills', 'live', 'SKILL.md'), 'utf8');
      expect(md).toContain('name: live');
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
