import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import type { QuestionItemDTO, SessionStatus, SnapshotPayload } from 'shared/types';
import { type DB, db, schema } from '../db';
import { kimiPaths } from './kimi-config/paths';
import { peekPendingPrompt } from './pending-prompts';
import type { ActiveSession, KimiSessionManager } from './session-manager';
import { type LiveOverlay, parseWireFromBytes, wireEventsToBlocks } from './wire-events';

export interface BuildSnapshotArgs {
  sessionId: string;
  manager: KimiSessionManager;
  db?: DB;
}

export async function buildSnapshot(args: BuildSnapshotArgs): Promise<SnapshotPayload | null> {
  const dbh = args.db ?? db;

  const [sessRow] = await dbh
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, args.sessionId))
    .limit(1);
  if (!sessRow) return null;

  const wireBytes = await readWireBytesPreferringDisk(sessRow, dbh);
  const events = parseWireFromBytes(wireBytes);

  const active = args.manager.peek(args.sessionId);
  const overlay = active ? buildLiveOverlay(active) : null;
  const blocks = wireEventsToBlocks(events, { overlay });

  const pending = await peekPendingPrompt(args.sessionId, dbh);
  if (pending !== null) {
    blocks.push({
      kind: 'user',
      id: `user:pending:${args.sessionId}`,
      content: pending.text,
      createdAt: pending.enqueuedAt.toISOString(),
      status: 'pending',
    });
  }

  return {
    blocks,
    status: sessRow.status as SessionStatus,
    totalTokens: sessRow.totalTokens,
    title: sessRow.title,
    pendingPrompt: pending
      ? { text: pending.text, enqueuedAt: pending.enqueuedAt.toISOString() }
      : null,
  };
}

async function readWireBytesPreferringDisk(sessRow: any, dbh: DB): Promise<string> {
  if (sessRow.kimiSessionId) {
    const dir = kimiPaths().sessionDir(sessRow.workDir, sessRow.kimiSessionId);
    const wirePath = path.join(dir, 'wire.jsonl');
    try {
      return await readFile(wirePath, 'utf8');
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  const [row] = await dbh
    .select({ wireJsonl: schema.sessionFiles.wireJsonl })
    .from(schema.sessionFiles)
    .where(eq(schema.sessionFiles.sessionId, sessRow.id))
    .limit(1);

  return row?.wireJsonl ?? '';
}

function buildLiveOverlay(active: ActiveSession): LiveOverlay {
  const pendingApprovals = new Map<
    string,
    { id: string; action: string; description: string; requestId: string }
  >();
  for (const [reqId, pending] of active.pendingApprovals.entries()) {
    pendingApprovals.set(reqId, {
      id: pending.payload.id,
      action: pending.payload.action,
      description: pending.payload.description,
      requestId: pending.requestId,
    });
  }

  const pendingQuestions = new Map<
    string,
    { id: string; requestId: string; questions: QuestionItemDTO[] }
  >();
  for (const [reqId, pending] of active.pendingQuestions.entries()) {
    pendingQuestions.set(reqId, {
      id: pending.payload.id,
      requestId: pending.questionRequestId,
      questions: pending.payload.questions,
    });
  }

  return {
    pendingApprovals,
    pendingQuestions,
    liveTextDelta: active.liveTextDelta,
    liveThinkingDelta: active.liveThinkingDelta,
    liveTurnIdx: active.liveTurnIdx,
    liveStepIdx: active.liveStepIdx,
    partialToolCallArgs: active.partialToolCallArgs,
  };
}
