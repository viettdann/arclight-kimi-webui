import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { KimiPaths } from '@moonshot-ai/kimi-agent-sdk';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { type DB, schema } from '../db';
import { logger } from '../lib/logger';
import { fileSize, readRange, workDirHash } from './kimi-session';

export async function catchUpWireBackup(args: {
  sessionRowId: string;
  workDir: string;
  kimiSessionId: string;
  db: DB;
  prevOffset: number;
}): Promise<void> {
  const dbh = args.db;
  const dir = KimiPaths.sessionDir(args.workDir, args.kimiSessionId);
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
    const dir = KimiPaths.sessionDir(row.workDir, row.kimiSessionId);
    const wirePath = path.join(dir, 'wire.jsonl');

    if (!existsSync(wirePath)) {
      logger.warn({ sessionId: row.id }, 'wire.jsonl path does not exist, skipping catch up');
      continue;
    }

    const diskSize = await fileSize(wirePath);

    const [fileRow] = await db
      .select({ offset: schema.sessionFiles.wireByteOffset })
      .from(schema.sessionFiles)
      .where(eq(schema.sessionFiles.sessionId, row.id))
      .limit(1);

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
