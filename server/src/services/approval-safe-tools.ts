import { logger } from '../lib/logger';

/**
 * Read-only tools the `auto` approval tier auto-approves on tool name alone.
 * The name comes from the `ToolCall` (`function.name`) correlated to an
 * `ApprovalRequest` by `tool_call_id` — NOT from `ApprovalRequest.action`,
 * which is a human-readable label (e.g. "edit file").
 *
 * The SDK has no allowlist surface — it only exposes a binary `yoloMode` — so
 * the tier is implemented here: the session runs with `yoloMode=false` (each
 * tool still fires `approval_request`), and the pump auto-approves safe ones.
 */
export const DEFAULT_SAFE_TOOLS: readonly string[] = [
  'read',
  'ls',
  'glob',
  'grep',
  'view',
  'search',
];

const DEFAULT_SAFE_SET: ReadonlySet<string> = new Set(DEFAULT_SAFE_TOOLS);

/**
 * Tool names that run an arbitrary shell command. The tool name alone is never
 * enough to auto-approve — the command string is vetted by
 * {@link isShellCommandSafe}.
 */
const SHELL_TOOL_SET: ReadonlySet<string> = new Set(['shell', 'bash', 'sh', 'command']);

/**
 * Read-only shell binaries safe to auto-approve. A command auto-approves only
 * when its single invocation is one of these with no shell metacharacters.
 */
export const SAFE_SHELL_BINARIES: readonly string[] = [
  'cat',
  'find',
  'grep',
  'head',
  'ls',
  'pwd',
  'rg',
  'stat',
  'tail',
  'tree',
  'wc',
  'which',
];
const SAFE_SHELL_BINARY_SET: ReadonlySet<string> = new Set(SAFE_SHELL_BINARIES);

/**
 * Files too sensitive to read without explicit human approval, even via an
 * otherwise read-only tool. Matched against the basename of any path-like token
 * (a `read`/`view` argument or a token inside a shell command): `.env` and its
 * variants (`.env.local`, `.env.production`, ...), plus common secret material.
 * A match forces the request to ask, never auto-approve.
 */
const SECRET_FILE = /(^|\/)(\.env(\.[\w.-]+)?|\.netrc|id_[a-z0-9]+|credentials(\.\w+)?)$/i;
const SECRET_FILE_EXT = /\.(pem|key|p12|pfx)$/i;

function isSecretPath(token: string): boolean {
  // Strip surrounding quotes a shell token may carry.
  const t = token.replace(/^['"]|['"]$/g, '');
  const base = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t;
  return SECRET_FILE.test(t) || SECRET_FILE.test(base) || SECRET_FILE_EXT.test(base);
}

/**
 * True if any string value reachable in `args` (a tool's parsed arguments) names
 * a secret file. Walks nested objects/arrays so a path under any key is caught
 * without depending on the SDK's argument key names.
 */
function argsTouchSecret(args: unknown): boolean {
  if (typeof args === 'string') return isSecretPath(args);
  if (Array.isArray(args)) return args.some(argsTouchSecret);
  if (args && typeof args === 'object') return Object.values(args).some(argsTouchSecret);
  return false;
}

/**
 * Shell metacharacters that introduce a second command, redirection, expansion,
 * substitution, or backgrounding when they appear *outside* quotes. Inside a
 * single- or double-quoted string the shell treats them literally, so vetting
 * strips quoted spans first (see {@link isShellCommandSafe}) and tests only the
 * unquoted remainder. Globs (`*?[]`) and `~` are included: outside quotes the
 * shell expands them, which can reach beyond the intended target.
 */
const SHELL_METACHAR = /[;&|<>`$(){}\n\r\\!*?[\]~#]/;

/**
 * Discard-only redirections that are harmless for a read-only command:
 * `>/dev/null`, `2>/dev/null`, `&>/dev/null`, and `2>&1`. Stripped before the
 * metachar gate so e.g. `find ... 2>/dev/null` auto-approves; any redirect that
 * targets a real file still trips the gate and is asked.
 */
const DISCARD_REDIRECT = /(?:[12]?&?>{1,2}\s*\/dev\/null|2>&1)/g;

/**
 * Replace every single- and double-quoted span with a placeholder so quoted
 * metacharacters (e.g. the `*` in `find -name "*.sln"`) don't trip the metachar
 * gate. An unterminated quote yields `null` — treated as unsafe by the caller.
 */
function stripQuotedSpans(s: string): string | null {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const close = s.indexOf(ch, i + 1);
      if (close === -1) return null; // unterminated quote
      out += 'Q'; // collapse the quoted span to an inert token
      i = close + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * True iff `command` is a single read-only invocation safe to auto-approve: the
 * leading token is a known read-only binary, no argument names a secret file,
 * and — outside any quoted strings — the command carries no shell
 * metacharacters (no chaining, piping, redirection, substitution, globbing, or
 * expansion). Anything else — including an empty/whitespace command or an
 * unterminated quote — is fail-safe false.
 */
export function isShellCommandSafe(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === '') return false;
  const unquoted = stripQuotedSpans(trimmed);
  if (unquoted === null) return false;
  // Drop harmless discard-redirects, then any remaining metachar disqualifies.
  if (SHELL_METACHAR.test(unquoted.replace(DISCARD_REDIRECT, ''))) return false;
  // No unquoted metachars → whitespace splitting yields a faithful argv.
  const tokens = trimmed.split(/\s+/);
  const binary = tokens[0];
  if (binary === undefined || binary.includes('/')) return false;
  if (!SAFE_SHELL_BINARY_SET.has(binary)) return false;
  // Even a read-only binary must not target a secret file.
  if (tokens.some(isSecretPath)) return false;
  return true;
}

/**
 * Decide whether the `auto` tier may approve a tool without asking.
 *
 * @param toolName the real tool name from `ToolCall.function.name`.
 * @param opts.command the shell command (for shell-family tools).
 * @param opts.args the tool's parsed arguments (for secret-path screening).
 *
 * Read-only tools pass on name alone, unless an argument names a secret file.
 * Shell tools pass only when their `command` is vetted by
 * {@link isShellCommandSafe}. Everything else is asked.
 */
export function isAutoApprovable(
  toolName: string,
  opts: { command?: string; args?: unknown; userAllowlist?: readonly string[] } = {},
): boolean {
  const { command, args, userAllowlist } = opts;
  // The SDK reports tool names with inconsistent casing (e.g. "Shell", "Read").
  // Match case-insensitively against the lowercase allowlists.
  const name = toolName.toLowerCase();

  if (SHELL_TOOL_SET.has(name)) {
    if (command === undefined) {
      logger.info({ toolName }, 'auto-approve: shell tool without command, asking');
      return false;
    }
    return isShellCommandSafe(command);
  }

  const nameSafe = DEFAULT_SAFE_SET.has(name) || (userAllowlist?.includes(name) ?? false);
  if (!nameSafe) {
    logger.info({ toolName }, 'auto-approve: tool not in safe list, asking');
    return false;
  }
  if (argsTouchSecret(args)) {
    logger.info({ toolName }, 'auto-approve: read targets a secret file, asking');
    return false;
  }
  return true;
}
