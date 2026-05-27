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

async function ensureKimiMetadataInner(shareDir: string, workDir: string): Promise<void> {
  const filePath = path.join(shareDir, 'kimi.json');
  const meta = await readMetadata(filePath);

  const existing = meta.work_dirs.find((entry) => entry.path === workDir && entry.kaos === 'local');
  if (existing) return;

  meta.work_dirs.push({ path: workDir, kaos: 'local', last_session_id: null });
  const next: KimiMetadata = { work_dirs: meta.work_dirs };
  await writeAtomic(filePath, JSON.stringify(next, null, 2));
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
  const prev = queues.get(shareDir) ?? Promise.resolve();
  const next = prev.then(() => ensureKimiMetadataInner(shareDir, workDir));
  // Swallow rejection in the chain stored in the map so subsequent calls
  // don't see a sticky rejection; the awaited `next` still surfaces errors
  // to the current caller.
  queues.set(
    shareDir,
    next.catch(() => undefined),
  );
  await next;
}
