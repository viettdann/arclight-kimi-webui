import {
  type Options,
  type Query,
  query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalMode, EffortLevel } from 'shared/types';
import { db } from '../../db';
import { logger } from '../../lib/logger';
import { ProviderUnavailableError, resolveProviderForUser } from '../providers/resolve';
import type { ActiveSession } from '../session-manager';
import { restoreSkillsForUser } from '../skills/restore';
import { getGitIncludeCoAuthoredBy } from '../user-settings';
import { agentConfigDirFor, agentHomeFor } from './agent-paths';
import { buildCanUseTool } from './approval';
import { buildAgentEnv } from './env';
import { ensureClaudeOnboarding } from './onboarding';
import { saveOnlySessionStore } from './session-store';
import { restoreLocalSession } from './transcript-store';

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
 * Map the session effort level to the SDK `effort` option. `null` omits it,
 * leaving the provider/model default in place.
 */
function effortOptions(effort: EffortLevel | null): Partial<Options> {
  return effort ? { effort } : {};
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
  const provider = await resolveProviderForUser(db, active.userId, active.providerId);
  if (!provider) throw new ProviderUnavailableError('no provider selected');

  // Per-user isolation: HOME + CLAUDE_CONFIG_DIR derive from the validated
  // workDir (which embeds the user slug), never the host. Bootstrap the
  // per-user config dir's onboarding flag once before the first turn so the
  // headless binary doesn't block; idempotent on later turns.
  const home = agentHomeFor(active.workDir);
  const configDir = agentConfigDirFor(active.workDir);
  await ensureClaudeOnboarding(configDir);
  // Materialize the user's enabled skills into the (tmpfs, restart-wiped) config
  // dir before the subprocess spawns, so the SDK discovers them at init — it
  // scans the skills dir once per process, not per turn. Best-effort: it logs and
  // swallows on failure, never aborting the turn.
  await restoreSkillsForUser(db, active.userId, configDir);
  const env = buildAgentEnv(provider, { home, configDir });

  // Git attribution: by default strip Claude's `Co-Authored-By` trailer (and the
  // PR attribution) from agent-driven commits. Empty strings hide attribution
  // entirely; opting in leaves the SDK default in place. Loaded into the
  // flag-settings layer via `options.settings`.
  const includeCoAuthoredBy = await getGitIncludeCoAuthoredBy(db, active.userId);
  const attribution = includeCoAuthoredBy ? undefined : { commit: '', pr: '' };

  // Resume-in-place: rematerialize the transcript from the DB store (the single
  // source of truth) into THIS per-user config dir, beside the materialized
  // skills, so the binary resumes from a dir that has both. The query runs with
  // `saveOnlySessionStore` (load disabled), so the SDK never builds its own
  // `/tmp/claude-resume-*` dir — which would carry the transcript but no skills,
  // leaving the resumed turn with zero skills. The subprocess has not started
  // yet, so no concurrent write races this. Only runs on resume (a new session
  // has nothing to restore and keeps the file the binary creates).
  if (opts.resume) {
    await restoreLocalSession(active.workDir, opts.resume);
  }

  const q = query({
    prompt: opts.prompt,
    options: {
      // Claude Code's full default system prompt; `'project'` layers the project
      // CLAUDE.md on top, `'user'` loads the per-user config dir
      // (`$CLAUDE_CONFIG_DIR`) so user-scope skills materialized into
      // `$CLAUDE_CONFIG_DIR/skills` by restoreSkillsForUser are discovered.
      // Without `'user'`, only built-in plugin skills load and uploaded skills
      // never surface. Both sources are per-user isolated via agent-paths.
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project'],
      model: active.model ?? undefined,
      cwd: active.workDir,
      abortController,
      canUseTool: buildCanUseTool(active),
      includePartialMessages: true,
      toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
      // Native Opus 4.6+ encrypts raw thinking server-side; request API-side
      // summaries so thinking blocks stream readable text. Hidden CLI flag
      // (`--thinking-display`, choices summarized|omitted) — the SDK-mode
      // binary never sets `display` on its own (interactive-only path). No-op
      // when thinking is disabled (binary guards on thinking type).
      extraArgs: { 'thinking-display': 'summarized' },
      env,
      // Dual-write transcript mirror: the subprocess writes local JSONL, the SDK
      // mirrors each frame to the DB store. `eager` flushes per frame (~100ms) so
      // a mid-turn reload sees the transcript within ~1 frame of live. Save-only
      // (load disabled) so resume stays in place — see `restoreLocalSession`.
      sessionStore: saveOnlySessionStore,
      sessionStoreFlush: 'eager',
      // Highest-priority "flag settings" layer. Workflows are always enabled so
      // ultracode (xhigh + standing workflow orchestration) can be turned on per
      // session; attribution overrides only set when we strip the SDK default.
      settings: {
        enableWorkflows: true,
        // The web client has no Artifact renderer; disable the tool so the model
        // never emits an artifact the UI can only show as a raw tool result.
        disableArtifact: true,
        // Disable the CLI's auto-memory: no read/write of the auto-memory
        // directory, no recall supervisor. Per-user memory is out of scope here.
        autoMemoryEnabled: false,
        ...(active.ultracode ? { ultracode: true } : {}),
        ...(attribution ? { attribution } : {}),
      },
      ...permissionOptions(active.approvalMode),
      // Ultracode is a non-destructive runtime override: force thinking on and
      // stop sending our own effort so the SDK's internally-driven xhigh effort
      // isn't fought. Stored `active.thinking`/`active.effort` are untouched —
      // turning ultracode off reverts to them.
      ...thinkingOptions(active.ultracode ? true : active.thinking),
      ...(active.ultracode ? {} : effortOptions(active.effort)),
      ...(opts.resume ? { resume: opts.resume } : {}),
      stderr: (line: string) => logger.debug({ line }, 'claude stderr'),
    },
  });

  active.query = q;
  active.abortController = abortController;
  return q;
}

/**
 * Tear down a session's live subprocess without unregistering the session. The
 * streaming-input query is interrupted (best-effort — it may already be idle),
 * its subprocess aborted, and the bridge closed; the consumer's `for await`
 * then ends and resets `turnInProgress`. The session stays in memory and
 * respawns lazily on the next `ensureQuery`. No-op when no query is live.
 *
 * Shared by the provider-change respawn, the idle reaper, and the skill-change
 * refresh.
 */
export async function disposeQuery(active: ActiveSession): Promise<void> {
  if (!active.query) return;
  try {
    await active.query.interrupt();
  } catch {
    // Already idle or finalized — abort still tears the subprocess down.
  }
  active.abortController?.abort();
  active.bridge?.close();
  active.query = null;
  active.abortController = null;
  active.bridge = null;
  // A fresh subprocess reloads skills from disk, so any pending refresh is moot.
  active.skillsDirty = false;
}
