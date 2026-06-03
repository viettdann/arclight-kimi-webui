import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureKimiMetadata,
  removeKimiMetadata,
} from '../../../src/services/kimi-config/share-metadata';

let shareDir: string;

beforeEach(async () => {
  shareDir = await mkdtemp(path.join(tmpdir(), 'kimi-share-meta-'));
});

afterEach(async () => {
  await rm(shareDir, { recursive: true, force: true });
});

describe('ensureKimiMetadata', () => {
  it('creates kimi.json with the new entry when file is missing', async () => {
    await ensureKimiMetadata(shareDir, '/work/dir-a');
    const raw = await readFile(path.join(shareDir, 'kimi.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      work_dirs: [{ path: '/work/dir-a', kaos: 'local', last_session_id: null }],
    });
  });

  it('appends entry while preserving an unrelated existing entry', async () => {
    const file = path.join(shareDir, 'kimi.json');
    const existing = {
      work_dirs: [{ path: '/other/dir', kaos: 'local', last_session_id: 'abc' }],
    };
    await writeFile(file, JSON.stringify(existing));

    await ensureKimiMetadata(shareDir, '/work/dir-a');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    expect(parsed.work_dirs).toEqual([
      { path: '/other/dir', kaos: 'local', last_session_id: 'abc' },
      { path: '/work/dir-a', kaos: 'local', last_session_id: null },
    ]);
  });

  it('is idempotent when a matching entry already exists', async () => {
    const file = path.join(shareDir, 'kimi.json');
    const existing = {
      work_dirs: [{ path: '/work/dir-a', kaos: 'local', last_session_id: 'preserved' }],
    };
    const original = JSON.stringify(existing);
    await writeFile(file, original);

    await ensureKimiMetadata(shareDir, '/work/dir-a');
    const after = await readFile(file, 'utf8');
    expect(after).toBe(original);
  });

  it('throws on malformed JSON', async () => {
    const file = path.join(shareDir, 'kimi.json');
    await writeFile(file, '{ this is not json');
    await expect(ensureKimiMetadata(shareDir, '/work/dir-a')).rejects.toBeDefined();
  });

  it('leaves no *.tmp.* siblings after a successful write', async () => {
    await ensureKimiMetadata(shareDir, '/work/dir-a');
    const entries = await readdir(shareDir);
    expect(entries.some((e) => e.includes('.tmp.'))).toBe(false);
    expect(entries).toContain('kimi.json');
  });

  it('serializes two concurrent calls so both entries land in the file', async () => {
    await Promise.all([
      ensureKimiMetadata(shareDir, '/work/dir-a'),
      ensureKimiMetadata(shareDir, '/work/dir-b'),
    ]);
    const parsed = JSON.parse(await readFile(path.join(shareDir, 'kimi.json'), 'utf8'));
    const paths = (parsed.work_dirs as Array<{ path: string }>).map((e) => e.path).sort();
    expect(paths).toEqual(['/work/dir-a', '/work/dir-b']);
  });
});

describe('removeKimiMetadata', () => {
  it('removes the matching entry while preserving the others', async () => {
    const file = path.join(shareDir, 'kimi.json');
    const existing = {
      work_dirs: [
        { path: '/work/dir-a', kaos: 'local', last_session_id: null },
        { path: '/work/dir-b', kaos: 'local', last_session_id: 'keep' },
      ],
    };
    await writeFile(file, JSON.stringify(existing));

    await removeKimiMetadata(shareDir, '/work/dir-a');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    expect(parsed.work_dirs).toEqual([
      { path: '/work/dir-b', kaos: 'local', last_session_id: 'keep' },
    ]);
  });

  it('matches on path alone, regardless of kaos', async () => {
    const file = path.join(shareDir, 'kimi.json');
    await writeFile(
      file,
      JSON.stringify({
        work_dirs: [{ path: '/work/dir-a', kaos: 'remote', last_session_id: null }],
      }),
    );

    await removeKimiMetadata(shareDir, '/work/dir-a');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    expect(parsed.work_dirs).toEqual([]);
  });

  it('is a no-op (no write) when no entry matches', async () => {
    const file = path.join(shareDir, 'kimi.json');
    const original = JSON.stringify({
      work_dirs: [{ path: '/work/dir-a', kaos: 'local', last_session_id: null }],
    });
    await writeFile(file, original);

    await removeKimiMetadata(shareDir, '/work/absent');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('does not create kimi.json when the file is missing', async () => {
    await removeKimiMetadata(shareDir, '/work/dir-a');
    const entries = await readdir(shareDir);
    expect(entries).not.toContain('kimi.json');
  });

  it('leaves no *.tmp.* siblings after removal', async () => {
    const file = path.join(shareDir, 'kimi.json');
    await writeFile(
      file,
      JSON.stringify({
        work_dirs: [{ path: '/work/dir-a', kaos: 'local', last_session_id: null }],
      }),
    );
    await removeKimiMetadata(shareDir, '/work/dir-a');
    const entries = await readdir(shareDir);
    expect(entries.some((e) => e.includes('.tmp.'))).toBe(false);
  });
});
