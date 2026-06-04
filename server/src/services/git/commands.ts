import type {
  GitBranchEntry,
  GitBranchResponse,
  GitCommandResponse,
  GitLogEntry,
  GitLogResponse,
  GitProvider,
  GitStatusEntry,
  GitStatusResponse,
  GitSubcommand,
} from 'shared/types/git-credentials';
import { buildGitContext } from './clone';
import { runGit } from './run';

// ─────────────────────────── Constants ───────────────────────────

const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

// Patterns in git stderr that indicate an auth failure on the remote: no
// credential, bad/expired token, 401. Re-picking a credential can resolve these.
const AUTH_FAILURE_PATTERNS = [
  /Authentication failed/i,
  /could not read Username/i,
  /fatal: Authentication failed/i,
  /HTTP 4\d{2}/,
  /Request failed with status code: 40[13]/,
  /remote: HTTP Basic: Access denied/i,
  /fatal: could not read Password/i,
  /The requested URL returned error: 40[13]/,
];

// Patterns indicating the credential WAS accepted but the remote refused the
// operation on permission grounds (e.g. a PAT missing write scope on push).
// Re-picking the same credential won't help — only one with more scope will.
const FORBIDDEN_PATTERNS = [
  /HTTP 403/,
  /status code: 403/,
  /The requested URL returned error: 403/,
  /remote: Permission to .+ denied/i, // GitHub
  /TF40\d{4,5}/, // Azure DevOps permission errors (e.g. TF401027)
  /403 Forbidden/i,
];

// ─────────────────────────── Types ───────────────────────────

export interface GitCommandArgs {
  command: GitSubcommand;
  args?: string[];
  cwd: string;
  credentialId?: string;
  inlineToken?: string;
  provider?: GitProvider;
}

export interface GitCredentialResolver {
  getOwned: (
    userId: string,
    credentialId: string,
  ) => Promise<{ provider: string; token: string } | null>;
}

// ─────────────────────────── Helpers ───────────────────────────

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_BYTES) return text;
  return `${text.slice(0, MAX_OUTPUT_BYTES)}\n... (output truncated)`;
}

/**
 * Classify a failed remote command's stderr into the kind of failure it is.
 *
 *   - `exitCode === 0` → null (no failure).
 *   - When a credential WAS applied, check FORBIDDEN_PATTERNS first: a 403 means
 *     the token was accepted but lacks scope, and the generic `/HTTP 4\d{2}/`
 *     auth pattern would otherwise swallow it as a re-pickable auth failure.
 *   - Otherwise an AUTH_FAILURE_PATTERNS match → 'auth' (missing credential,
 *     401, bad/expired token — re-picking helps).
 *   - No match → null.
 */
export function classifyRemoteFailure(
  exitCode: number,
  stderr: string,
  authApplied: boolean,
): 'auth' | 'forbidden' | null {
  if (exitCode === 0) return null;
  if (authApplied && FORBIDDEN_PATTERNS.some((re) => re.test(stderr))) return 'forbidden';
  if (AUTH_FAILURE_PATTERNS.some((re) => re.test(stderr))) return 'auth';
  return null;
}

/**
 * Build git args for a whitelisted subcommand. Each command has its own
 * builder — raw user args are never passed to the shell directly.
 */
export function buildArgs(cmd: GitSubcommand, userArgs: string[]): string[] {
  switch (cmd) {
    case 'status':
      // -z (NUL-separated) sidesteps path quoting: paths with spaces / unicode
      // / control chars come through raw. --untracked-files=all lists files
      // inside untracked directories instead of collapsing to `? dir/`.
      return ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'];
    case 'log':
      return ['log', '--oneline', '-n', '50', ...userArgs];
    case 'diff':
      // userArgs can contain ['--staged'] or ['--', 'path/to/file']
      return ['diff', ...userArgs];
    case 'add':
      // userArgs = file paths
      return ['add', ...userArgs];
    case 'commit': {
      // userArgs[0] = commit message
      const message = userArgs[0];
      if (!message) throw new Error('commit message required');
      return ['commit', '-m', message];
    }
    case 'push':
      return ['push', ...userArgs];
    case 'pull':
      return ['pull', ...userArgs];
    case 'fetch':
      return ['fetch', ...userArgs];
    case 'branch':
      return ['branch', '-a'];
    case 'checkout':
      return ['checkout', ...userArgs];
    case 'stash': {
      if (userArgs[0] === 'pop') return ['stash', 'pop'];
      return ['stash'];
    }
    default:
      throw new Error(`unsupported git command: ${cmd}`);
  }
}

/** Whether this command touches the remote and may need auth. */
export function isRemoteCommand(cmd: GitSubcommand): boolean {
  return cmd === 'push' || cmd === 'pull' || cmd === 'fetch';
}

// ─────────────────────────── Core execution ───────────────────────────

export async function getRemoteUrl(cwd: string): Promise<string | null> {
  const r = await runGit(['remote', 'get-url', 'origin'], {
    cwd,
    timeoutMs: READ_TIMEOUT_MS,
    captureStdout: true,
  });
  if (r.exitCode !== 0 || r.spawnFailed || r.timedOut) return null;
  return r.stdout.trim() || null;
}

/**
 * Resolve auth context for a remote-touching command. Returns { baseArgs, env }
 * with the auth header injected, or null if no credential is available.
 */
async function resolveAuthContext(
  cwd: string,
  credentialId: string | undefined,
  inlineToken: string | undefined,
  provider: GitProvider | undefined,
  credentialResolver: GitCredentialResolver | undefined,
  userId: string | undefined,
): Promise<{ baseArgs: string[]; childEnv: Record<string, string> } | null> {
  let token: string | undefined;
  let resolvedProvider: GitProvider | undefined;

  // Priority: credentialId > inlineToken
  if (credentialId && credentialResolver && userId) {
    const row = await credentialResolver.getOwned(userId, credentialId);
    if (row) {
      token = row.token;
      resolvedProvider = row.provider as GitProvider;
    }
  } else if (inlineToken && provider) {
    token = inlineToken;
    resolvedProvider = provider;
  }

  if (!token || !resolvedProvider) return null;

  const remoteUrl = await getRemoteUrl(cwd);
  if (!remoteUrl) return null;

  try {
    return buildGitContext(remoteUrl, resolvedProvider, token);
  } catch {
    return null;
  }
}

// ─────────────────────────── Public API ───────────────────────────

/**
 * Execute a whitelisted git command and return structured result.
 * For remote-touching commands (push/pull/fetch), injects auth if credentials
 * are provided and detects auth failures.
 */
export async function executeGitCommand(
  args: GitCommandArgs,
  credentialResolver?: GitCredentialResolver,
  userId?: string,
): Promise<GitCommandResponse> {
  const gitArgs = buildArgs(args.command, args.args ?? []);
  const timeoutMs = isRemoteCommand(args.command) ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;

  // Build auth context for remote commands
  let extraArgs: string[] = [];
  let childEnv: Record<string, string> | undefined;
  let authApplied = false;

  if (isRemoteCommand(args.command)) {
    const authCtx = await resolveAuthContext(
      args.cwd,
      args.credentialId,
      args.inlineToken,
      args.provider,
      credentialResolver,
      userId,
    );
    if (authCtx) {
      extraArgs = authCtx.baseArgs;
      childEnv = authCtx.childEnv;
      authApplied = true;
    }
  }

  const r = await runGit([...extraArgs, ...gitArgs], {
    cwd: args.cwd,
    env: childEnv,
    timeoutMs,
    captureStdout: true,
  });

  const result: GitCommandResponse = {
    exitCode: r.exitCode,
    stdout: truncateOutput(r.stdout),
    stderr: truncateOutput(r.stderr),
    timedOut: r.timedOut,
  };

  // Classify remote failures: a forbidden (403) means the credential was
  // applied but lacks scope (re-pick won't help → permissionDenied); an auth
  // failure means re-picking a credential might resolve it (→ requiresAuth).
  if (isRemoteCommand(args.command)) {
    const kind = classifyRemoteFailure(r.exitCode, r.stderr, authApplied);
    if (kind === 'forbidden') result.permissionDenied = true;
    else if (kind === 'auth') result.requiresAuth = true;
  }

  return result;
}

// ─────────────────────────── Commit ───────────────────────────

export interface CommitFilesArgs {
  cwd: string;
  /** Paths relative to the repo root, as reported by GitStatusEntry.path. */
  files: string[];
  message: string;
  /** Author/committer identity for this commit (from the authed user). */
  userName: string;
  userEmail: string;
}

/** Thrown when a requested file matches no entry in the working-tree status. */
export class UnknownFilesError extends Error {
  constructor(public readonly files: string[]) {
    super(`unknown_files: ${files.join(', ')}`);
    this.name = 'UnknownFilesError';
  }
}

/**
 * Commit exactly the selected files without staging anything else.
 *
 * Strategy (verified empirically): porcelain status classifies the selection,
 * then `git commit -- <pathspec>` commits only those paths. Files not in the
 * pathspec stay uncommitted even if already staged. Two wrinkles handled here:
 *   - Untracked files (`?`) aren't known to the index, so a pathspec commit
 *     can't see them; `git add -N` intent-adds them first.
 *   - A rename (`2`) record's delete half lives under the ORIGINAL path; the
 *     pathspec must include origPath too or the delete is left behind.
 *
 * Identity is injected via `-c user.name`/`-c user.email` BEFORE `commit` in
 * argv (matching executeGitCommand's `[...extraArgs, ...gitArgs]` ordering).
 * Everything is an argv array — never a shell string — and `--` always
 * precedes the pathspec so a leading-dash filename can't be read as a flag.
 */
export async function commitFiles(args: CommitFilesArgs): Promise<GitCommandResponse> {
  const statusRaw = await executeGitCommand({ command: 'status', cwd: args.cwd });
  const status = parseStatus(statusRaw);
  const byPath = new Map(status.entries.map((e) => [e.path, e]));

  // Reject any selected file that matches no working-tree status entry.
  const unknown = args.files.filter((f) => !byPath.has(f));
  if (unknown.length > 0) throw new UnknownFilesError(unknown);

  // Build pathspec: each selected path, plus the original path for renames.
  // A Set dedupes in case both the new and old paths were selected.
  const pathspec = new Set<string>();
  const untracked: string[] = [];
  for (const file of args.files) {
    const entry = byPath.get(file);
    if (!entry) continue; // unreachable after the check above; keeps TS happy
    pathspec.add(entry.path);
    if (entry.origPath) pathspec.add(entry.origPath);
    if (entry.statusCode.startsWith('?')) untracked.push(entry.path);
  }

  // Intent-add untracked files so the pathspec commit can see them.
  if (untracked.length > 0) {
    const addR = await runGit(['add', '-N', '--', ...untracked], {
      cwd: args.cwd,
      timeoutMs: WRITE_TIMEOUT_MS,
      captureStdout: true,
    });
    if (addR.exitCode !== 0) {
      return {
        exitCode: addR.exitCode,
        stdout: truncateOutput(addR.stdout),
        stderr: truncateOutput(addR.stderr),
        timedOut: addR.timedOut,
      };
    }
  }

  const r = await runGit(
    [
      '-c',
      `user.name=${args.userName}`,
      '-c',
      `user.email=${args.userEmail}`,
      'commit',
      '-m',
      args.message,
      '--',
      ...pathspec,
    ],
    {
      cwd: args.cwd,
      timeoutMs: WRITE_TIMEOUT_MS,
      captureStdout: true,
    },
  );

  return {
    exitCode: r.exitCode,
    stdout: truncateOutput(r.stdout),
    stderr: truncateOutput(r.stderr),
    timedOut: r.timedOut,
  };
}

// ─────────────────────────── Structured shortcuts ───────────────────────────

/**
 * Parse `git status --porcelain=v2 --branch --untracked-files=all -z`.
 *
 * With `-z`, records are separated by NUL (not newline) and paths are emitted
 * raw (never C-quoted), so spaces / unicode / control chars survive intact.
 * Field layout per record type (fields within a record are space-separated;
 * the path itself is everything after the fixed fields and may contain spaces):
 *   `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`           (8 fixed fields)
 *   `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>` then a separate
 *      NUL-delimited token for the original path                (9 fixed fields)
 *   `? <path>` / `! <path>`                                    (slice off `? `)
 *   `# branch.head <name>` / `# branch.ab +A -B`               (headers)
 */
export function parseStatus(raw: GitCommandResponse): GitStatusResponse {
  const entries: GitStatusEntry[] = [];
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;

  // Records are NUL-separated. A rename/copy (`2`) record consumes the NEXT
  // record too (its original path), so iterate by index rather than for..of.
  const records = raw.stdout.split('\0');
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;

    // Headers (NUL-terminated like any other record): only head + ab matter.
    if (rec.startsWith('# branch.head ')) {
      const name = rec.slice('# branch.head '.length);
      branch = name === '(detached)' ? null : name;
      continue;
    }
    if (rec.startsWith('# branch.ab ')) {
      const parts = rec.slice('# branch.ab '.length).split(' ');
      if (parts[0]) ahead = Math.abs(Number(parts[0]));
      if (parts[1]) behind = Math.abs(Number(parts[1]));
      continue;
    }
    if (rec.startsWith('#')) continue;

    if (rec.startsWith('? ') || rec.startsWith('! ')) {
      // Do NOT trim — the path is raw and may legitimately end with whitespace.
      entries.push({ statusCode: rec.slice(0, 2), path: rec.slice(2) });
      continue;
    }

    if (rec.startsWith('1 ') || rec.startsWith('2 ')) {
      const isRename = rec.startsWith('2 ');
      // statusCode is the XY field (positions 2-4): '.M', 'M.', 'R.', etc.
      const statusCode = rec.slice(2, 4);
      // Path begins after the fixed header fields. Split off exactly N tokens
      // and keep the remainder verbatim (the path itself can contain spaces).
      const fixedFields = isRename ? 9 : 8;
      const path = nthFieldOnward(rec, fixedFields);
      if (isRename) {
        // The original path is the following NUL-delimited record.
        const origPath = records[i + 1] ?? '';
        i += 1;
        entries.push({ statusCode, path, origPath });
      } else {
        entries.push({ statusCode, path });
      }
    }
  }

  return { branch, entries, ahead, behind };
}

/**
 * Return everything after the first `n` space-separated fields of `rec`,
 * verbatim (the tail may itself contain spaces). Returns '' if there are
 * fewer than `n` fields.
 */
function nthFieldOnward(rec: string, n: number): string {
  let idx = 0;
  for (let f = 0; f < n; f++) {
    const sp = rec.indexOf(' ', idx);
    if (sp === -1) return '';
    idx = sp + 1;
  }
  return rec.slice(idx);
}

/** Parse `git log --oneline -n 50` into structured response. */
export function parseLog(raw: GitCommandResponse, currentBranch: string | null): GitLogResponse {
  const entries: GitLogEntry[] = [];

  for (const line of raw.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: <hash> <message>  (we add --format="%h %s||%an||%ar" below)
    // With plain --oneline: <hash> <message>
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;
    const hash = trimmed.slice(0, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1);
    entries.push({ hash, message: rest, author: '', date: '' });
  }

  return { entries, currentBranch };
}

/** Parse `git branch -a` into structured response. */
export function parseBranches(raw: GitCommandResponse): GitBranchResponse {
  const branches: GitBranchEntry[] = [];
  let currentBranch: string | null = null;

  for (const line of raw.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isCurrent = trimmed.startsWith('* ');
    const name = trimmed.replace(/^\* /, '').replace(/^\+ /, '').trim();
    if (!name) continue;

    if (isCurrent) currentBranch = name;
    branches.push({ name, isCurrent, isRemote: name.startsWith('remotes/') });
  }

  return { branches, currentBranch };
}

/**
 * Enhanced log with author and date. Uses a custom format string.
 */
export async function getDetailedLog(cwd: string): Promise<GitLogResponse> {
  const [r, branchR] = await Promise.all([
    runGit(['log', '--format=%h||%s||%an||%ar', '-n', '50'], {
      cwd,
      timeoutMs: READ_TIMEOUT_MS,
      captureStdout: true,
    }),
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeoutMs: READ_TIMEOUT_MS,
      captureStdout: true,
    }),
  ]);

  if (r.exitCode !== 0 || r.spawnFailed) {
    return { entries: [], currentBranch: null };
  }

  const currentBranch =
    branchR.exitCode === 0 && !branchR.spawnFailed ? branchR.stdout.trim() || null : null;

  const entries: GitLogEntry[] = [];
  for (const line of r.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, message, author, date] = trimmed.split('||');
    if (hash && message) {
      entries.push({ hash, message, author: author ?? '', date: date ?? '' });
    }
  }

  return { entries, currentBranch };
}
