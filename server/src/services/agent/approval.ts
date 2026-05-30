import { randomUUID } from 'node:crypto';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type {
  AnswerQuestionPayload,
  ApprovalRequestPayload,
  ApprovalResponse,
  QuestionItemDTO,
  QuestionRequestPayload,
} from 'shared/types';
import { logger } from '../../lib/logger';
import { broadcastEvent } from '../../lib/ws-broadcast';
import { isAutoApprovable } from '../approval-safe-tools';
import type { ActiveSession } from '../session-manager';
import { sessionManager } from '../session-manager';

// The SDK `canUseTool` callback is the single channel for both permission
// prompts AND the `AskUserQuestion` tool. It is wired for every approval mode:
// AskUserQuestion is a question to the user (not a permission) and must surface
// even under bypass. Each prompt parks an awaited Promise whose resolver lives
// in `active.pendingApprovals` / `active.pendingQuestions`; the matching WS
// handler (`approve_tool` / `answer_question`) settles it, and
// `sessionManager.drainPendingRequests` settles any survivors on teardown.

const ASK_USER_QUESTION = 'AskUserQuestion';

/** Shape of one option inside an `AskUserQuestion` question, as the SDK emits it. */
interface RawQuestionOption {
  label?: unknown;
  description?: unknown;
  preview?: unknown;
}

/** Shape of one `AskUserQuestion` question, as the SDK emits it (camelCase). */
interface RawQuestion {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiSelect?: unknown;
}

/**
 * Normalize the SDK `AskUserQuestion` input into the wire `QuestionItemDTO[]`.
 * Each entry is guarded so a malformed question never poisons the prompt — the
 * SDK schema is camelCase (`multiSelect`), already matching the DTO.
 */
export function normalizeQuestions(input: Record<string, unknown>): QuestionItemDTO[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q): QuestionItemDTO[] => {
    if (q === null || typeof q !== 'object') return [];
    const { question, header, options, multiSelect } = q as RawQuestion;
    if (typeof question !== 'string') return [];
    const opts = Array.isArray(options)
      ? options.flatMap((o): QuestionItemDTO['options'][number][] => {
          if (o === null || typeof o !== 'object') return [];
          const { label, description, preview } = o as RawQuestionOption;
          if (typeof label !== 'string') return [];
          return [
            {
              label,
              ...(typeof description === 'string' ? { description } : {}),
              ...(typeof preview === 'string' ? { preview } : {}),
            },
          ];
        })
      : [];
    return [
      {
        question,
        ...(typeof header === 'string' ? { header } : {}),
        options: opts,
        ...(typeof multiSelect === 'boolean' ? { multiSelect } : {}),
      },
    ];
  });
}

/**
 * Derive a short action label and human-readable description from the tool name
 * and its input. Kept deliberately small — the client renders the rich view;
 * this is the fallback label carried on `ApprovalRequestPayload`.
 */
function describeTool(
  toolName: string,
  input: Record<string, unknown>,
): {
  action: string;
  description: string;
} {
  const target =
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.path === 'string' && input.path) ||
    (typeof input.command === 'string' && input.command) ||
    (typeof input.url === 'string' && input.url) ||
    '';
  const action = toolName;
  const description = target ? `${toolName}: ${target}` : toolName;
  return { action, description };
}

/**
 * Build the SDK `canUseTool` callback for a session. Handles `AskUserQuestion`
 * in every mode, plus the per-mode permission flow (bypass/safe/ask).
 */
export function buildCanUseTool(active: ActiveSession): CanUseTool {
  return async (toolName, input, { signal, toolUseID }): Promise<PermissionResult> => {
    // ── AskUserQuestion: surfaces in every mode, including bypass ──
    if (toolName === ASK_USER_QUESTION) {
      return askQuestion(active, input, signal, toolUseID);
    }

    // ── bypass: never block a tool ──
    if (active.approvalMode === 'bypass') {
      return { behavior: 'allow', updatedInput: input };
    }

    // ── safe: auto-approve read-only tools; fall through otherwise ──
    if (active.approvalMode === 'safe') {
      const command = typeof input.command === 'string' ? input.command : undefined;
      if (isAutoApprovable(toolName, { args: input, command })) {
        return { behavior: 'allow', updatedInput: input };
      }
    }

    // ── ask (and safe fall-through): prompt the user ──
    return askApproval(active, toolName, input, signal, toolUseID);
  };
}

/** Park an `AskUserQuestion` prompt and await the user's answers. */
async function askQuestion(
  active: ActiveSession,
  input: Record<string, unknown>,
  signal: AbortSignal,
  toolUseID: string,
): Promise<PermissionResult> {
  if (signal.aborted) return { behavior: 'deny', message: 'aborted' };

  const requestId = randomUUID();
  const payload: QuestionRequestPayload = {
    id: toolUseID,
    requestId,
    questions: normalizeQuestions(input),
  };

  const answer = await new Promise<AnswerQuestionPayload>((resolve) => {
    active.pendingQuestions.set(requestId, { requestId, payload, resolve });
    if (signal.aborted) {
      active.pendingQuestions.delete(requestId);
      resolve({ requestId, answers: {} });
      return;
    }
    const onAbort = () => {
      const pending = active.pendingQuestions.get(requestId);
      if (!pending) return;
      active.pendingQuestions.delete(requestId);
      pending.resolve({ requestId, answers: {} });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    broadcastEvent<QuestionRequestPayload>(active, 'question_request', payload, sessionManager);
  });

  active.pendingQuestions.delete(requestId);

  // Empty answers ⇒ drained/aborted: deny so the turn can settle cleanly.
  if (Object.keys(answer.answers).length === 0) {
    return { behavior: 'deny', message: 'aborted' };
  }

  return {
    behavior: 'allow',
    updatedInput: {
      ...input,
      answers: answer.answers,
      ...(answer.annotations ? { annotations: answer.annotations } : {}),
    },
    decisionClassification: 'user_temporary',
  };
}

/** Park a permission prompt and await the user's approve/reject decision. */
async function askApproval(
  active: ActiveSession,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  toolUseID: string,
): Promise<PermissionResult> {
  if (signal.aborted) return { behavior: 'deny', message: 'aborted' };

  const requestId = randomUUID();
  const { action, description } = describeTool(toolName, input);
  const command =
    toolName === 'Bash' && typeof input.command === 'string' ? input.command : undefined;
  const payload: ApprovalRequestPayload = {
    id: toolUseID || toolName,
    action,
    description,
    requestId,
    ...(command !== undefined ? { command } : {}),
  };

  const response = await new Promise<ApprovalResponse>((resolve) => {
    active.pendingApprovals.set(requestId, { requestId, payload, resolve });
    if (signal.aborted) {
      active.pendingApprovals.delete(requestId);
      resolve('reject');
      return;
    }
    const onAbort = () => {
      const pending = active.pendingApprovals.get(requestId);
      if (!pending) return;
      active.pendingApprovals.delete(requestId);
      pending.resolve('reject');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    broadcastEvent<ApprovalRequestPayload>(active, 'approval_request', payload, sessionManager);
  });

  active.pendingApprovals.delete(requestId);

  if (response === 'approve' || response === 'approve_for_session') {
    logger.debug({ toolName, requestId, response }, 'tool approved by user');
    return { behavior: 'allow', updatedInput: input };
  }
  return { behavior: 'deny', message: 'Denied by user' };
}
