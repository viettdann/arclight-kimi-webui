import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

interface WorkDirEntry {
  path: string;
  kaos: string;
  last_session_id: string | null;
}

interface KimiMetadata {
  work_dirs: WorkDirEntry[];
}

// Per-shareDir serialization queue so concurrent calls within the process
// read→write atomically.
const queues = new Map<string, Promise<void>>();

async function readMetadata(filePath: string): Promise<KimiMetadata> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { work_dirs: [] };
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<KimiMetadata>;
  const workDirs = Array.isArray(parsed.work_dirs) ? (parsed.work_dirs as WorkDirEntry[]) : [];
  return { work_dirs: workDirs };
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  const fh = await open(tmpPath, 'w', 0o600);
  try {
    await fh.writeFile(contents);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmpPath, filePath);
}

// Serialize `fn` behind any in-flight operation for the same `shareDir` so
// read→write stays atomic across concurrent ensure/remove calls. The chain
// stored in the map swallows rejections so a failure doesn't stick to later
// callers; the awaited `next` still surfaces errors to the current caller.
async function withQueue(shareDir: string, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(shareDir) ?? Promise.resolve();
  const next = prev.then(fn);
  queues.set(
    shareDir,
    next.catch(() => undefined),
  );
  await next;
}

async function ensureKimiMetadataInner(shareDir: string, workDir: string): Promise<void> {
  const filePath = path.join(shareDir, 'kimi.json');
  const meta = await readMetadata(filePath);

  const existing = meta.work_dirs.find((entry) => entry.path === workDir && entry.kaos === 'local');
  if (existing) return;

  meta.work_dirs.push({ path: workDir, kaos: 'local', last_session_id: null });
  const next: KimiMetadata = { work_dirs: meta.work_dirs };
  await writeAtomic(filePath, JSON.stringify(next, null, 2));
}

async function removeKimiMetadataInner(shareDir: string, workDir: string): Promise<void> {
  const filePath = path.join(shareDir, 'kimi.json');
  const meta = await readMetadata(filePath);

  const filtered = meta.work_dirs.filter((entry) => entry.path !== workDir);
  // No matching entry (also covers the ENOENT → empty case): skip the write so
  // we never create an empty kimi.json just to remove something absent.
  if (filtered.length === meta.work_dirs.length) return;

  await writeAtomic(filePath, JSON.stringify({ work_dirs: filtered }, null, 2));
}

/**
 * Ensure `<shareDir>/kimi.json` lists `{ path: workDir, kaos: 'local' }`.
 *
 * Idempotent: returns immediately if a matching entry already exists. On
 * ENOENT the file is initialized with `{ work_dirs: [] }`. Other fields on
 * the parsed JSON are ignored — only `work_dirs` is preserved. Writes
 * atomically via tmp file + rename with mode 0o600. Concurrent calls for the
 * same `shareDir` are serialized within the process via an in-module queue.
 *
 * Throws on parse or IO errors; the caller decides whether to fail the
 * containing operation.
 */
export async function ensureKimiMetadata(shareDir: string, workDir: string): Promise<void> {
  await withQueue(shareDir, () => ensureKimiMetadataInner(shareDir, workDir));
}

/**
 * Remove every `work_dirs` entry whose `path === workDir` from
 * `<shareDir>/kimi.json`.
 *
 * Idempotent: a no-op (no write) when no entry matches or the file is absent —
 * so it never creates an empty kimi.json. Matches on `path` alone (a workDir is
 * unique) regardless of `kaos`. Same atomic write + per-shareDir serialization
 * as `ensureKimiMetadata`.
 */
export async function removeKimiMetadata(shareDir: string, workDir: string): Promise<void> {
  await withQueue(shareDir, () => removeKimiMetadataInner(shareDir, workDir));
}
