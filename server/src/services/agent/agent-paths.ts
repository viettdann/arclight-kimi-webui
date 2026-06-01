import path from 'node:path';
import { env } from '../../env';

/**
 * Single source of truth for mapping a session `cwd` to the per-user `$HOME` and
 * `CLAUDE_CONFIG_DIR` the SDK subprocess runs with. Pure — no IO, no DB.
 *
 * The leak this prevents: forwarding the host `$HOME` lets the `claude_code`
 * preset read the host's `~/.claude/CLAUDE.md`, and a shared `CLAUDE_CONFIG_DIR`
 * lets one user's state bleed into another. Both are keyed off the user slug
 * already embedded in the workDir, so every agent gets an isolated home + state.
 *
 * Layout:
 *   ${WORKSPACE_ROOT}/<userSlug>/            -> $HOME (per-user sandbox)
 *     .claude/CLAUDE.md                      -> user's own global memory
 *     <project>/                             -> cwd; <cwd>/CLAUDE.md = project memory
 *   ${AGENT_STATE_ROOT}/<userSlug>/          -> CLAUDE_CONFIG_DIR (.claude.json,
 *                                               projects/, sessions/, tasks/)
 */

/**
 * Base for per-user agent config/state. Defaults to `${DATA_DIR}/agent-state`;
 * the `CLAUDE_CONFIG_DIR` env var overrides it (the var keeps the SDK-standard
 * name even though it now points at the ROOT, with per-user subdirs appended
 * here). The per-user `CLAUDE_CONFIG_DIR` the binary actually sees is
 * `${AGENT_STATE_ROOT}/<userSlug>`.
 */
export const AGENT_STATE_ROOT = env.CLAUDE_CONFIG_DIR;

/**
 * Extract the user slug — the first path segment of `cwd` relative to
 * `workspaceRoot`. `validateWorkDir` already guarantees every session cwd sits
 * under `${WORKSPACE_ROOT}/<userSlug>`, so this is a 1:1 read of that segment.
 * Throws if `cwd` is not under `workspaceRoot` (a misuse guard — callers always
 * pass a validated workDir).
 */
export function userSlugFromCwd(cwd: string, workspaceRoot: string = env.WORKSPACE_ROOT): string {
  const rel = path.relative(workspaceRoot, cwd);
  const [slug] = rel.split(path.sep);
  if (!slug || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`cwd is not under workspaceRoot: cwd=${cwd} workspaceRoot=${workspaceRoot}`);
  }
  return slug;
}

/**
 * Whether `cwd` sits under `workspaceRoot` — i.e. it is one of our own
 * agent-run workspaces (vs. a foreign/remote project workDir that lives outside
 * the workspace). Pure predicate; never throws. Use it to filter before calling
 * the slug-deriving helpers, which require an in-workspace cwd. A cwd that fails
 * this check has no per-user agent state (the binary never ran there under our
 * config dir), so any state cleanup for it is a no-op.
 */
export function isUnderWorkspace(cwd: string, workspaceRoot: string = env.WORKSPACE_ROOT): boolean {
  const rel = path.relative(workspaceRoot, cwd);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The agent `$HOME` for a session: `${WORKSPACE_ROOT}/<userSlug>`. */
export function agentHomeFor(cwd: string): string {
  return path.join(env.WORKSPACE_ROOT, userSlugFromCwd(cwd));
}

/** The agent `CLAUDE_CONFIG_DIR` for a session: `${AGENT_STATE_ROOT}/<userSlug>`. */
export function agentConfigDirFor(cwd: string): string {
  return path.join(AGENT_STATE_ROOT, userSlugFromCwd(cwd));
}

/**
 * Neutral home + config dir for non-session SDK calls that load no memory and
 * persist no state (`pingProvider`, `titleViaAgent`). They run with
 * `settingSources: []` and `persistSession: false`, so a shared throwaway dir is
 * safe — it carries no user data, only the `hasCompletedOnboarding` flag so the
 * headless binary never blocks. The leading `_` cannot collide with a real user
 * slug: `slug(email)` lowercases the email local part, which cannot itself be
 * the literal `_ephemeral` unless an email's local part is exactly that string.
 */
export function ephemeralPaths(): { home: string; configDir: string } {
  const configDir = path.join(AGENT_STATE_ROOT, '_ephemeral');
  return { home: configDir, configDir };
}

/**
 * Path to a user's own global memory file: `${WORKSPACE_ROOT}/<userSlug>/
 * .claude/CLAUDE.md`. Because `$HOME` for that user's agents is
 * `${WORKSPACE_ROOT}/<userSlug>`, the `claude_code` preset loads this file as
 * the user's global memory — isolated per user, never the host's. Used by the
 * preferences route to CRUD that exact file.
 */
export function userMemoryPath(userSlug: string): string {
  return path.join(env.WORKSPACE_ROOT, userSlug, '.claude', 'CLAUDE.md');
}
