import {
  type Options,
  type Query,
  query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalMode } from 'shared/types';
import { logger } from '../../lib/logger';
import type { ActiveSession } from '../session-manager';
import { buildCanUseTool } from './approval';
import { buildAgentEnv } from './env';

// Build and launch the live SDK `query` for one in-flight turn. The session's
// approval mode maps to the SDK permission mode + the `canUseTool` callback;
// `canUseTool` is always passed (it is also the AskUserQuestion channel). The
// returned `Query` handle + its `AbortController` are stored on the session for
// interrupt/teardown.

/**
 * Map the session approval mode to the SDK permission options.
 * - `bypass` → bypass all checks (requires the dangerous-skip flag).
 * - `safe`   → auto-accept file edits; non-edit tools still reach `canUseTool`.
 * - `ask`    → standard prompt-on-dangerous behavior.
 */
function permissionOptions(mode: ApprovalMode): Partial<Options> {
  switch (mode) {
    case 'bypass':
      return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true };
    case 'safe':
      return { permissionMode: 'acceptEdits' };
    default:
      return { permissionMode: 'default' };
  }
}

/**
 * Map the session thinking flag to the SDK `thinking` config. Adaptive lets the
 * model decide depth (default for capable models); disabled turns it off.
 */
function thinkingOptions(thinking: boolean): Partial<Options> {
  return { thinking: thinking ? { type: 'adaptive' } : { type: 'disabled' } };
}

/**
 * Construct the live query for a turn and bind it (plus its abort controller)
 * to the session. Async because the subprocess env is resolved asynchronously.
 * The SDK resolves its own bundled `claude` binary from node_modules.
 */
export async function startQuery(
  active: ActiveSession,
  opts: { prompt: AsyncIterable<SDKUserMessage>; resume?: string | null },
): Promise<Query> {
  const abortController = new AbortController();
  const env = await buildAgentEnv();

  const q = query({
    prompt: opts.prompt,
    options: {
      settingSources: ['project'],
      model: active.model ?? undefined,
      cwd: active.workDir,
      abortController,
      canUseTool: buildCanUseTool(active),
      includePartialMessages: true,
      toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
      env,
      ...permissionOptions(active.approvalMode),
      ...thinkingOptions(active.thinking),
      ...(opts.resume ? { resume: opts.resume } : {}),
      stderr: (line: string) => logger.debug({ line }, 'claude stderr'),
    },
  });

  active.query = q;
  active.abortController = abortController;
  return q;
}
