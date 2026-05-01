import type { QuestionItemDTO } from 'shared/types';
import { type DB, db, schema } from '../db';

// Persistence helpers for the `messages` table. Each row maps 1:1 to a wire
// event the client will see in a snapshot replay. Keeping the inserts narrow
// (one helper per role) makes the call sites in pump/handlers explicit about
// which role they are recording.

export interface InsertUserArgs {
  sessionId: string;
  content: string;
  db?: DB;
}

export interface InsertAssistantArgs {
  sessionId: string;
  content: string;
  thinking: string | null;
  db?: DB;
}

export interface InsertToolCallArgs {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  db?: DB;
}

export interface InsertToolResultArgs {
  sessionId: string;
  toolName: string;
  content: string;
  isError: boolean;
  db?: DB;
}

export interface InsertApprovalArgs {
  sessionId: string;
  requestId: string;
  action: string;
  description: string;
  db?: DB;
}

export interface InsertQuestionArgs {
  sessionId: string;
  requestId: string;
  questions: QuestionItemDTO[];
  db?: DB;
}

export async function insertUserMessage(args: InsertUserArgs): Promise<string> {
  const dbh = args.db ?? db;
  const [row] = await dbh
    .insert(schema.messages)
    .values({ sessionId: args.sessionId, role: 'user', content: args.content })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('insertUserMessage: insert returned no row');
  return row.id;
}

export async function insertAssistantMessage(args: InsertAssistantArgs): Promise<string> {
  const dbh = args.db ?? db;
  const [row] = await dbh
    .insert(schema.messages)
    .values({
      sessionId: args.sessionId,
      role: 'assistant',
      content: args.content,
      thinking: args.thinking,
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('insertAssistantMessage: insert returned no row');
  return row.id;
}

export async function insertToolCall(args: InsertToolCallArgs): Promise<string> {
  const dbh = args.db ?? db;
  const [row] = await dbh
    .insert(schema.messages)
    .values({
      sessionId: args.sessionId,
      role: 'tool-call',
      toolName: args.toolName,
      toolInput: args.toolInput,
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('insertToolCall: insert returned no row');
  return row.id;
}

export async function insertToolResult(args: InsertToolResultArgs): Promise<string> {
  const dbh = args.db ?? db;
  const [row] = await dbh
    .insert(schema.messages)
    .values({
      sessionId: args.sessionId,
      role: 'tool-result',
      toolName: args.toolName,
      content: args.content,
      isError: args.isError,
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('insertToolResult: insert returned no row');
  return row.id;
}

export async function insertApproval(args: InsertApprovalArgs): Promise<string> {
  const dbh = args.db ?? db;
  const [row] = await dbh
    .insert(schema.messages)
    .values({
      sessionId: args.sessionId,
      role: 'approval',
      content: args.description,
      toolName: args.action,
      toolInput: { requestId: args.requestId },
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('insertApproval: insert returned no row');
  return row.id;
}

export async function insertQuestionMessage(args: InsertQuestionArgs): Promise<string> {
  const dbh = args.db ?? db;
  const [row] = await dbh
    .insert(schema.messages)
    .values({
      sessionId: args.sessionId,
      role: 'question',
      content: null,
      toolName: null,
      toolInput: { requestId: args.requestId, questions: args.questions },
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('insertQuestionMessage: insert returned no row');
  return row.id;
}
