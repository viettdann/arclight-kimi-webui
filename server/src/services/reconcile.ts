import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { type DB, schema } from '../db';
import { logger } from '../lib/logger';
import { kimiPaths } from './kimi-config/paths';
import { fileSize, readRange, workDirHash } from './kimi-session';

export async function catchUpWireBackup(args: {
  sessionRowId: string;
  workDir: string;
  kimiSessionId: string;
  db: DB;
  prevOffset: number;
}): Promise<void> {
  const dbh = args.db;
  const dir = kimiPaths().sessionDir(args.workDir, args.kimiSessionId);
  const wirePath = path.join(dir, 'wire.jsonl');

  const { prevOffset } = args;

  const wireSize = await fileSize(wirePath);
  let appendBytes: Buffer;
  let newOffset: number;
  let resetWire = false;

  if (wireSize < prevOffset) {
    appendBytes = await readFile(wirePath);
    newOffset = wireSize;
    resetWire = true;
  } else if (wireSize > prevOffset) {
    appendBytes = await readRange(wirePath, prevOffset, wireSize - prevOffset);
    newOffset = wireSize;
  } else {
    appendBytes = Buffer.alloc(0);
    newOffset = prevOffset;
  }

  const wireChunk = appendBytes.toString('utf8');
  const hash = workDirHash(args.workDir);

  await dbh
    .insert(schema.sessionFiles)
    .values({
      sessionId: args.sessionRowId,
      workDirHash: hash,
      wireJsonl: wireChunk,
      contextJsonl: '',
      stateJson: '',
      wireByteOffset: newOffset,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.sessionFiles.sessionId,
      set: {
        workDirHash: hash,
        wireJsonl: resetWire ? wireChunk : sql`${schema.sessionFiles.wireJsonl} || ${wireChunk}`,
        wireByteOffset: newOffset,
        updatedAt: sql`now()`,
      },
    });
}

export async function reconcileOnStartup({ db }: { db: DB }): Promise<void> {
  logger.info('Running reconcileOnStartup...');

  const activeSessions = await db
    .select({
      id: schema.sessions.id,
      workDir: schema.sessions.workDir,
      kimiSessionId: schema.sessions.kimiSessionId,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.status, 'active'), isNotNull(schema.sessions.kimiSessionId)));

  for (const row of activeSessions) {
    if (!row.kimiSessionId) continue;
    const dir = kimiPaths().sessionDir(row.workDir, row.kimiSessionId);
    const wirePath = path.join(dir, 'wire.jsonl');
    const diskExists = existsSync(wirePath);

    const [fileRow] = await db
      .select({
        offset: schema.sessionFiles.wireByteOffset,
        wireLen: sql<number>`length(${schema.sessionFiles.wireJsonl})`,
        ctxLen: sql<number>`length(${schema.sessionFiles.contextJsonl})`,
        stateLen: sql<number>`length(${schema.sessionFiles.stateJson})`,
      })
      .from(schema.sessionFiles)
      .where(eq(schema.sessionFiles.sessionId, row.id))
      .limit(1);

    const dbHasBackup =
      fileRow != null && (fileRow.wireLen > 0 || fileRow.ctxLen > 0 || fileRow.stateLen > 0);

    if (!diskExists && !dbHasBackup) {
      // Zombie: row says active but neither disk wire nor DB backup exists.
      // Close it so listings stop surfacing an unresumable session.
      await db
        .update(schema.sessions)
        .set({ status: 'closed' })
        .where(eq(schema.sessions.id, row.id));
      logger.warn({ sessionId: row.id }, 'zombie session pruned (no wire on disk or DB)');
      continue;
    }

    if (!diskExists) {
      // Disk gone but DB has backup — leave it for lazy restoreFromBackup.
      continue;
    }

    const diskSize = await fileSize(wirePath);
    const dbOffset = fileRow?.offset ?? 0;

    if (diskSize > dbOffset) {
      const lag = diskSize - dbOffset;
      logger.info({ sessionId: row.id, lag }, 'Disk wire.jsonl ahead of DB; catching up...');
      try {
        await catchUpWireBackup({
          sessionRowId: row.id,
          workDir: row.workDir,
          kimiSessionId: row.kimiSessionId,
          db,
          prevOffset: dbOffset,
        });
        logger.info({ sessionId: row.id }, 'Caught up successfully');
      } catch (err) {
        logger.error({ err, sessionId: row.id }, 'Failed to catch up wire backup');
      }
    }
  }
}
