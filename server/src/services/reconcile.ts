import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { type DB, schema } from '../db';
import { logger } from '../lib/logger';
import { kimiPaths } from './kimi-config/paths';
import { fileSize, readRange } from './kimi-session';

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
  if (wireSize === prevOffset) return;

  if (wireSize < prevOffset) {
    logger.warn(
      { sessionRowId: args.sessionRowId, wireSize, prevOffset },
      'wire shrunk; skipping reconcile',
    );
    return;
  }

  const appendBytes = await readRange(wirePath, prevOffset, wireSize - prevOffset);
  const newOffset = wireSize;

  const wireChunk = appendBytes.toString('utf8');

  await dbh
    .insert(schema.kimiSessionFiles)
    .values({
      sessionId: args.sessionRowId,
      wireJsonl: wireChunk,
      contextJsonl: '',
      stateJson: '',
      wireByteOffset: newOffset,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.kimiSessionFiles.sessionId,
      set: {
        wireJsonl: sql`${schema.kimiSessionFiles.wireJsonl} || ${wireChunk}`,
        wireByteOffset: newOffset,
        updatedAt: sql`now()`,
      },
    });
}

export async function reconcileOnStartup({ db }: { db: DB }): Promise<void> {
  logger.info('Running reconcileOnStartup...');

  const sessions = await db
    .select({
      id: schema.kimiSessions.id,
      workDir: schema.kimiSessions.workDir,
      kimiSessionId: schema.kimiSessions.kimiSessionId,
    })
    .from(schema.kimiSessions)
    .where(isNotNull(schema.kimiSessions.kimiSessionId));

  for (const row of sessions) {
    if (!row.kimiSessionId) continue;
    const dir = kimiPaths().sessionDir(row.workDir, row.kimiSessionId);
    const wirePath = path.join(dir, 'wire.jsonl');
    const diskExists = existsSync(wirePath);

    const [fileRow] = await db
      .select({
        offset: schema.kimiSessionFiles.wireByteOffset,
        wireLen: sql<number>`length(${schema.kimiSessionFiles.wireJsonl})`,
        ctxLen: sql<number>`length(${schema.kimiSessionFiles.contextJsonl})`,
        stateLen: sql<number>`length(${schema.kimiSessionFiles.stateJson})`,
      })
      .from(schema.kimiSessionFiles)
      .where(eq(schema.kimiSessionFiles.sessionId, row.id))
      .limit(1);

    const dbHasBackup =
      fileRow != null && (fileRow.wireLen > 0 || fileRow.ctxLen > 0 || fileRow.stateLen > 0);

    if (!diskExists && !dbHasBackup) {
      // Zombie: a row with no wire on disk and no DB backup is unresumable —
      // there is no transcript to restore. Delete it (session_files cascades)
      // so it stops surfacing in listings as a dead, unopenable session.
      await db.delete(schema.kimiSessions).where(eq(schema.kimiSessions.id, row.id));
      logger.warn({ sessionId: row.id }, 'zombie session deleted (no wire on disk or DB)');
      continue;
    }

    if (!diskExists) {
      // Disk gone but DB has backup — leave it for lazy restoreFromBackup.
      // Cross-machine: foreign rows from another machine's `WORKSPACE_ROOT`
      // also land here. Adoption happens at first WS attach.
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
