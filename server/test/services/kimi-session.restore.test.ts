import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realFsPromises from 'node:fs/promises';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Session } from '@moonshot-ai/kimi-agent-sdk';
import { type CreateKimiArgs, restoreFromBackup } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
import { makeFakeDb, stubSession } from '../_helpers';

// Snapshot before any mock.module override (none in this file, but keep parity).
const _originalReadFile = realFsPromises.readFile;
void _originalReadFile;

// Stub the SDK paths so writes land in a temp dir and the real KIMI_SHARE_DIR
// is not touched.
let tmpShareDir: string;
let workspaceRoot: string;

beforeEach(async () => {
  tmpShareDir = await mkdtemp(path.join(tmpdir(), 'kimi-restore-share-'));
  workspaceRoot = await mkdtemp(path.join(tmpdir(), 'kimi-restore-ws-'));
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

    // Factory called with localWorkDir.
    expect(factoryCalls[0]?.workDir).toBe(localWorkDir);
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
