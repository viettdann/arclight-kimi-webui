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

// Patterns in git stderr that indicate an auth failure on the remote.
const AUTH_FAILURE_PATTERNS = [
  /Authentication failed/i,
  /could not read Username/i,
  /fatal: Authentication failed/i,
  /HTTP 4\d{2}/,
  /Request failed with status code: 40[13]/,
  /remote: HTTP Basic: Access denied/i,
  /fatal: could not read Password/i,
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

function detectAuthFailure(exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;
  return AUTH_FAILURE_PATTERNS.some((re) => re.test(stderr));
}

/**
 * Build git args for a whitelisted subcommand. Each command has its own
 * builder — raw user args are never passed to the shell directly.
 */
export function buildArgs(cmd: GitSubcommand, userArgs: string[]): string[] {
  switch (cmd) {
    case 'status':
      return ['status', '--porcelain=v2', '--branch'];
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

  // Detect auth failures for remote commands
  if (isRemoteCommand(args.command) && r.exitCode !== 0) {
    if (detectAuthFailure(r.exitCode, r.stderr)) {
      result.requiresAuth = true;
    }
  }

  return result;
}

// ─────────────────────────── Structured shortcuts ───────────────────────────

/** Parse `git status --porcelain=v2 --branch` into structured response. */
export function parseStatus(raw: GitCommandResponse): GitStatusResponse {
  const entries: GitStatusEntry[] = [];
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;

  for (const line of raw.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // porcelain v2 header lines: # branch.oid ..., # branch.head ..., # branch.upstream ..., # branch.ab ...
    if (trimmed.startsWith('# branch.head ')) {
      branch = trimmed.slice('# branch.head '.length);
      if (branch === '(detached)') branch = null;
    } else if (trimmed.startsWith('# branch.ab ')) {
      const parts = trimmed.slice('# branch.ab '.length).split(' ');
      if (parts[0]) ahead = Math.abs(Number(parts[0]));
      if (parts[1]) behind = Math.abs(Number(parts[1]));
    } else if (
      trimmed.startsWith('1 ') ||
      trimmed.startsWith('2 ') ||
      trimmed.startsWith('? ') ||
      trimmed.startsWith('! ')
    ) {
      // porcelain v2 entry
      let statusCode: string;
      let filePath: string;
      if (trimmed.startsWith('? ') || trimmed.startsWith('! ')) {
        statusCode = trimmed.slice(0, 2);
        filePath = trimmed.slice(2);
      } else {
        // "1 XY ..." or "2 XY ..." — XY is at positions 2-4
        statusCode = trimmed.slice(2, 4);
        // path is after the last space-separated field
        const parts = trimmed.split(' ');
        filePath = parts[parts.length - 1] ?? '';
      }
      entries.push({ statusCode, path: filePath });
    }
  }

  return { branch, entries, ahead, behind };
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
