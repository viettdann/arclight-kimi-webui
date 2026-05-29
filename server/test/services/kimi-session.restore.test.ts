import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realFsPromises from 'node:fs/promises';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import * as realLogger from '../../src/lib/logger';
import { makeFakeDb, stubSession } from '../_helpers';

// Snapshot before any mock.module override (none in this file, but keep parity).
const _originalReadFile = realFsPromises.readFile;
void _originalReadFile;

const errorCalls: Array<{ payload: unknown; msg: unknown }> = [];
const warnCalls: Array<{ payload: unknown; msg: unknown }> = [];

mock.module('../../src/lib/logger', () => ({
  ...realLogger,
  logger: {
    ...realLogger.logger,
    error: (payload: unknown, msg?: unknown) => {
      errorCalls.push({ payload, msg });
    },
    warn: (payload: unknown, msg?: unknown) => {
      warnCalls.push({ payload, msg });
    },
    info: () => {},
    debug: () => {},
  },
}));

// Redirect resolveShareDir() to a controllable per-test dir so the SDK's
// `kimiPaths().sessionDir(...)` writes land under `tmpShareDir` instead of
// the project's real `.kimi/`. `kimiPaths()` caches keyed by the resolved
// string, so a different value each test invalidates the cache.
let currentShareDir = '';
mock.module('../../src/services/kimi-config/share-dir', () => ({
  resolveShareDir: () => currentShareDir,
}));

// Import AFTER mock.module so kimi-session resolves the mocked logger.
const { restoreFromBackup } = await import('../../src/services/kimi-session');
const { KimiSessionManager } = await import('../../src/services/session-manager');
type CreateKimiArgs = import('../../src/services/kimi-session').CreateKimiArgs;

// Stub the SDK paths so writes land in a temp dir and the real KIMI_SHARE_DIR
// is not touched.
let tmpShareDir: string;
let workspaceRoot: string;

beforeEach(async () => {
  tmpShareDir = await mkdtemp(path.join(tmpdir(), 'kimi-restore-share-'));
  workspaceRoot = await mkdtemp(path.join(tmpdir(), 'kimi-restore-ws-'));
  currentShareDir = tmpShareDir;
  errorCalls.length = 0;
  warnCalls.length = 0;
});

afterEach(async () => {
  await rm(tmpShareDir, { recursive: true, force: true });
  await rm(workspaceRoot, { recursive: true, force: true });
});

afterAll(() => {
  mock.restore();
});

function joinedRow(over: Partial<{ workDir: string; projectName: string; kimiSessionId: string }>) {
  return {
    session: {
      id: 'sess-1',
      userId: 'alice',
      workDir: over.workDir ?? '/old/path/from/another/machine',
      projectName: over.projectName ?? 'projA',
      model: null,
      thinking: false,
      yoloMode: false,
      approvalMode: 'ask',
      status: 'active',
      kimiSessionId: over.kimiSessionId ?? 'kimi-x',
      title: null,
      totalTokens: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    },
    userEmail: 'alice@example.com',
  };
}

describe('restoreFromBackup — cross-machine adoption', () => {
  it('foreign row: materialises files under localWorkDir hash and updates sessions.workDir', async () => {
    const fake = makeFakeDb();
    // Joined select returns one row with a foreign workDir.
    fake.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    // session_files: a backup with non-empty wire bytes.
    fake.selectQueue.push([
      {
        sessionId: 'sess-1',
        wireJsonl: '{"hello":"world"}\n',
        contextJsonl: '',
        stateJson: '',
        wireByteOffset: 18,
      },
    ]);

    const factoryCalls: CreateKimiArgs[] = [];
    const factory = (args: CreateKimiArgs): Session => {
      factoryCalls.push(args);
      return stubSession({ sessionId: 'kimi-x', workDir: args.workDir });
    };

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    const localWorkDir = path.join(workspaceRoot, 'alice', 'projA');

    // Local work dir was created.
    const s = await stat(localWorkDir);
    expect(s.isDirectory()).toBe(true);

    // Factory called with localWorkDir, not the cached foreign workDir.
    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]?.workDir).toBe(localWorkDir);
    expect(factoryCalls[0]?.sessionId).toBe('kimi-x');
    expect(factoryCalls[0]?.shareDir).toBe(tmpShareDir);

    // Cached workDir got rewritten via UPDATE.
    const updateCall = fake.calls.find(
      (c) => c.op === 'update' && (c.values as { workDir?: string }).workDir === localWorkDir,
    );
    expect(updateCall).toBeDefined();

    // Manager registered with localWorkDir.
    const active = manager.peek('sess-1');
    expect(active?.workDir).toBe(localWorkDir);
  });

  it('local row (workDir matches localWorkDir): cascade UPDATE still fires (idempotent)', async () => {
    const fake = makeFakeDb();
    const localWorkDir = path.join(workspaceRoot, 'alice', 'projA');
    fake.selectQueue.push([joinedRow({ workDir: localWorkDir })]);
    fake.selectQueue.push([]); // empty session_files

    const factory = (args: CreateKimiArgs): Session =>
      stubSession({ sessionId: 'kimi-x', workDir: args.workDir });

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    // Cascade UPDATE fires unconditionally; rows already at localWorkDir are
    // a row-level no-op but the SQL statement still runs. The new value is
    // the local path (same as cached) so the row is unchanged.
    const updateCall = fake.calls.find(
      (c) => c.op === 'update' && (c.values as { workDir?: string }).workDir === localWorkDir,
    );
    expect(updateCall).toBeDefined();
  });

  it('cascade adoption: scoped UPDATE issues against (userId, projectName)', async () => {
    // We assert via the recorded UPDATE call carrying the new workDir, since
    // the fake DB does not model row matching for WHERE clauses. The real
    // statement scopes by userId + projectName so sibling foreign rows under
    // the same project flip atomically.
    const fake = makeFakeDb();
    fake.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path', projectName: 'kimi-dev' })]);
    fake.selectQueue.push([]); // no session_files

    const factory = (args: CreateKimiArgs): Session =>
      stubSession({ sessionId: 'kimi-x', workDir: args.workDir });

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    const localWorkDir = path.join(workspaceRoot, 'alice', 'kimi-dev');
    const updateCalls = fake.calls.filter(
      (c) => c.op === 'update' && (c.values as { workDir?: string }).workDir === localWorkDir,
    );
    // Exactly one statement covers all siblings — not one per sibling row.
    expect(updateCalls).toHaveLength(1);
  });

  it('empty session_files backup: skips on-disk materialise but still registers', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    fake.selectQueue.push([]); // no session_files row

    const factoryCalls: CreateKimiArgs[] = [];
    const factory = (args: CreateKimiArgs): Session => {
      factoryCalls.push(args);
      return stubSession({ sessionId: 'kimi-x', workDir: args.workDir });
    };

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    // localWorkDir still created.
    const localWorkDir = path.join(workspaceRoot, 'alice', 'projA');
    const s = await stat(localWorkDir);
    expect(s.isDirectory()).toBe(true);

    // Factory still called with localWorkDir (preserved through missing backup).
    expect(factoryCalls[0]?.workDir).toBe(localWorkDir);

    // Error log emitted for the missing session_files row.
    const missingLog = errorCalls.find(
      (e) =>
        (e.payload as { sessionId?: string })?.sessionId === 'sess-1' &&
        (e.payload as { kimiSessionId?: string })?.kimiSessionId === 'kimi-x' &&
        (e.payload as { workDir?: string })?.workDir === localWorkDir,
    );
    expect(missingLog).toBeDefined();
  });

  it('disk empty, DB has non-empty blobs: materializes all 3 files post-transform and seeds kimi.json', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    // loadEnvForInjection → getKimiConfig issues its own SELECT inside the
    // parallel Promise.all; that shift happens before the session_files shift
    // due to how Bun unwraps thenables. Push an empty row so getKimiConfig
    // walks the merge-from-defaults path without consuming our filesRow.
    fake.selectQueue.push([]);

    const wireJsonl = '{"turn_begin":1}\n{"more":2}\n';
    const contextJsonl =
      '{"role":"_system_prompt","content":"foreign-paths"}\n{"role":"user","content":"hi"}\n';
    const stateJson = JSON.stringify({
      custom_title: 't',
      additional_dirs: ['/foreign/extra'],
    });
    fake.selectQueue.push([
      {
        sessionId: 'sess-1',
        wireJsonl,
        contextJsonl,
        stateJson,
        wireByteOffset: 0,
      },
    ]);

    const factory = (args: CreateKimiArgs): Session =>
      stubSession({ sessionId: 'kimi-x', workDir: args.workDir });

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    const localWorkDir = path.join(workspaceRoot, 'alice', 'projA');
    // The SDK builds the on-disk session dir as
    // `<shareDir>/sessions/<md5(workDir)>/<sessionId>`. We don't care about
    // the hash here; just locate the only session dir under sessions/.
    const sessionsRoot = path.join(tmpShareDir, 'sessions');
    const hashes = await realFsPromises.readdir(sessionsRoot);
    expect(hashes).toHaveLength(1);
    const sessionDir = path.join(sessionsRoot, hashes[0] as string, 'kimi-x');

    const writtenWire = await readFile(path.join(sessionDir, 'wire.jsonl'), 'utf8');
    expect(writtenWire).toBe(wireJsonl);

    const writtenCtx = await readFile(path.join(sessionDir, 'context.jsonl'), 'utf8');
    // System-prompt head dropped; first non-empty line is the user turn.
    const firstLine = writtenCtx.split('\n').find((l) => l.length > 0);
    expect(firstLine).toBeDefined();
    const firstParsed = JSON.parse(firstLine as string);
    expect(firstParsed.role).not.toBe('_system_prompt');

    const writtenState = JSON.parse(await readFile(path.join(sessionDir, 'state.json'), 'utf8'));
    expect(writtenState.additional_dirs).toEqual([]);
    expect(writtenState.custom_title).toBe('t');

    // kimi.json seeded under the test shareDir.
    const meta = JSON.parse(await readFile(path.join(tmpShareDir, 'kimi.json'), 'utf8'));
    const found = (meta.work_dirs as Array<{ path: string; kaos: string }>).find(
      (e) => e.path === localWorkDir && e.kaos === 'local',
    );
    expect(found).toBeDefined();
  });

  it('disk has stale files, DB has blobs: disk content is overwritten with post-transform DB content', async () => {
    // Pre-seed a stale session dir on disk under tmpShareDir's session path.
    const localWorkDir = path.join(workspaceRoot, 'alice', 'projA');
    // We need to compute the SDK's md5 hash; rather than duplicate that, write
    // via restoreKimiFiles first by running a primer restore with stale data,
    // then inspect after the test restore.
    //
    // Approach: run restoreFromBackup twice. First with stale blobs; verify
    // the on-disk files end up matching the second call's post-transform
    // payload (proves overwrite, not append).
    const fake1 = makeFakeDb();
    fake1.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    fake1.selectQueue.push([]); // getKimiConfig shift (merge-from-defaults path)
    fake1.selectQueue.push([
      {
        sessionId: 'sess-1',
        wireJsonl: 'STALE_WIRE\n',
        contextJsonl: '{"role":"user","content":"stale"}\n',
        stateJson: JSON.stringify({ additional_dirs: ['/stale'], stale: true }),
        wireByteOffset: 0,
      },
    ]);
    const factory = (args: CreateKimiArgs): Session =>
      stubSession({ sessionId: 'kimi-x', workDir: args.workDir });
    const manager1 = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager: manager1,
      db: fake1.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    const sessionsRoot = path.join(tmpShareDir, 'sessions');
    const hashes = await realFsPromises.readdir(sessionsRoot);
    const sessionDir = path.join(sessionsRoot, hashes[0] as string, 'kimi-x');
    // Pre-condition: stale on disk.
    expect(await readFile(path.join(sessionDir, 'wire.jsonl'), 'utf8')).toBe('STALE_WIRE\n');

    // Second restore with fresh blobs.
    const fake2 = makeFakeDb();
    fake2.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    fake2.selectQueue.push([]); // getKimiConfig shift (merge-from-defaults path)
    fake2.selectQueue.push([
      {
        sessionId: 'sess-1',
        wireJsonl: 'FRESH_WIRE_DATA\n',
        contextJsonl: '{"role":"user","content":"fresh"}\n',
        stateJson: JSON.stringify({ additional_dirs: ['/should-clear'], fresh: true }),
        wireByteOffset: 0,
      },
    ]);
    const manager2 = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager: manager2,
      db: fake2.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    expect(await readFile(path.join(sessionDir, 'wire.jsonl'), 'utf8')).toBe('FRESH_WIRE_DATA\n');
    expect(await readFile(path.join(sessionDir, 'context.jsonl'), 'utf8')).toBe(
      '{"role":"user","content":"fresh"}\n',
    );
    const writtenState = JSON.parse(await readFile(path.join(sessionDir, 'state.json'), 'utf8'));
    expect(writtenState.fresh).toBe(true);
    expect(writtenState.additional_dirs).toEqual([]);
    expect(writtenState.stale).toBeUndefined();
    void localWorkDir;
  });

  it('resets wireByteOffset to byte length of restored wire blob', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    fake.selectQueue.push([]); // getKimiConfig shift (merge-from-defaults path)
    const wireJsonl = 'restored-bytes-éà\n'; // multi-byte chars
    const expectedOffset = Buffer.byteLength(wireJsonl, 'utf8');
    fake.selectQueue.push([
      {
        sessionId: 'sess-1',
        wireJsonl,
        contextJsonl: '',
        stateJson: '',
        wireByteOffset: 999, // stale offset that must be reset.
      },
    ]);

    const factory = (args: CreateKimiArgs): Session =>
      stubSession({ sessionId: 'kimi-x', workDir: args.workDir });

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    const offsetUpdate = fake.calls.find(
      (c) =>
        c.op === 'update' &&
        (c.values as { wireByteOffset?: number }).wireByteOffset === expectedOffset,
    );
    expect(offsetUpdate).toBeDefined();
  });

  it('filesRow == null: skips restore + logs error, but factory still called and manager registers', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([joinedRow({ workDir: '/legacy/abs/path' })]);
    fake.selectQueue.push([]); // no session_files row

    const factoryCalls: CreateKimiArgs[] = [];
    const factory = (args: CreateKimiArgs): Session => {
      factoryCalls.push(args);
      return stubSession({ sessionId: 'kimi-x', workDir: args.workDir });
    };

    const manager = new KimiSessionManager();
    await restoreFromBackup({
      sessionId: 'sess-1',
      manager,
      db: fake.db,
      env: { WORKSPACE_ROOT: workspaceRoot },
      shareDir: tmpShareDir,
      createKimiFn: factory,
    });

    const localWorkDir = path.join(workspaceRoot, 'alice', 'projA');

    // No session bundle under sessions/<hash>/kimi-x/ because restoreKimiFiles
    // was not invoked.
    const sessionsRoot = path.join(tmpShareDir, 'sessions');
    const hashes = await realFsPromises.readdir(sessionsRoot).catch(() => [] as string[]);
    for (const h of hashes) {
      const inner = await realFsPromises
        .readdir(path.join(sessionsRoot, h))
        .catch(() => [] as string[]);
      expect(inner).not.toContain('kimi-x');
    }

    // Factory called with localWorkDir.
    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]?.workDir).toBe(localWorkDir);

    // Manager registered.
    expect(manager.peek('sess-1')?.workDir).toBe(localWorkDir);

    // Error logged with the expected payload shape.
    const log = errorCalls.find(
      (e) =>
        (e.payload as { sessionId?: string })?.sessionId === 'sess-1' &&
        (e.payload as { kimiSessionId?: string })?.kimiSessionId === 'kimi-x' &&
        (e.payload as { workDir?: string })?.workDir === localWorkDir,
    );
    expect(log).toBeDefined();
  });

  it('closed row: throws not_found', async () => {
    const fake = makeFakeDb();
    fake.selectQueue.push([
      {
        ...joinedRow({}),
        session: { ...joinedRow({}).session, status: 'closed' },
      },
    ]);

    const factory = (args: CreateKimiArgs): Session =>
      stubSession({ sessionId: 'kimi-x', workDir: args.workDir });

    const manager = new KimiSessionManager();
    await expect(
      restoreFromBackup({
        sessionId: 'sess-1',
        manager,
        db: fake.db,
        env: { WORKSPACE_ROOT: workspaceRoot },
        shareDir: tmpShareDir,
        createKimiFn: factory,
      }),
    ).rejects.toThrow('not_found');
  });
});
