import type { GitProvider } from 'shared/types/git-credentials';
import { buildAuthHeader } from './auth-header';
import { runGit } from './run';
import { parseCloneUrl } from './url';

export interface ClonePhaseProgress {
  /** git phase label, e.g. "Receiving objects", "Resolving deltas". */
  phase: string;
  /** 0–100 within the phase. */
  percent: number;
}

export interface CloneRepoArgs {
  url: string;
  targetDir: string;
  provider: GitProvider;
  token: string;
  username?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Invoked as git reports progress; deduped so it only fires on real change. */
  onProgress?: (p: ClonePhaseProgress) => void;
  /** Specific branch to clone instead of the remote's default. */
  branch?: string;
}

// git writes `--progress` lines to stderr as "<Phase>: NN% (...)", overwriting
// the current line with `\r`. Capture the phase label and integer percent.
const CLONE_PROGRESS_RE =
  /(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s+(\d+)%/;

// Build a stderr-chunk handler that splits on `\r`/`\n`, parses progress lines,
// and forwards each distinct (phase, percent) pair to `onProgress`.
function makeProgressParser(onProgress: (p: ClonePhaseProgress) => void): (chunk: string) => void {
  let buffer = '';
  let lastPhase = '';
  let lastPercent = -1;
  return (chunk: string) => {
    buffer += chunk;
    const segments = buffer.split(/[\r\n]/);
    // Keep the trailing partial segment for the next chunk.
    buffer = segments.pop() ?? '';
    // A valid "<Phase>: NN% (...)" line is short; if a delimiter never arrives
    // (odd or hostile server output) cap the carried-over buffer so it can't
    // grow without bound for the lifetime of the clone.
    if (buffer.length > 8192) buffer = buffer.slice(-8192);
    for (const seg of segments) {
      const m = seg.match(CLONE_PROGRESS_RE);
      if (m?.[1] === undefined || m?.[2] === undefined) continue;
      const phase = m[1];
      const percent = Number(m[2]);
      if (phase === lastPhase && percent === lastPercent) continue;
      lastPhase = phase;
      lastPercent = percent;
      onProgress({ phase, percent });
    }
  };
}

export type CloneResult =
  | { ok: true; defaultBranch?: string }
  | { ok: false; kind: 'clone_failed' | 'clone_timeout'; error: string };

export interface TestRemoteArgs {
  url: string;
  provider: GitProvider;
  token: string;
  username?: string;
  timeoutMs: number;
}

// Trim git stderr down to the last few non-empty lines, capped in length, so
// the response carries a useful hint without leaking the whole transcript.
function trimStderr(stderr: string, fallback: string): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const tail = lines.slice(-3).join('\n');
  const msg = tail.length > 0 ? tail : fallback;
  return msg.length > 500 ? msg.slice(0, 500) : msg;
}

// Build the shared `git -c ...` prefix args plus the child env that carries the
// auth header out-of-band (so the token never appears in argv).
export function buildGitContext(
  url: string,
  provider: GitProvider,
  token: string,
  username?: string,
): { baseArgs: string[]; childEnv: Record<string, string> } {
  const parsed = parseCloneUrl(url);
  const origin = `${parsed.protocol}//${parsed.host}/`;
  const configKey = `http.${origin}.extraHeader`;
  const baseArgs = ['-c', 'credential.helper=', `--config-env=${configKey}=GIT_AUTH_HEADER`];
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_AUTH_HEADER: buildAuthHeader(provider, token, username),
    GIT_TERMINAL_PROMPT: '0',
  };
  return { baseArgs, childEnv };
}

export async function cloneRepo(args: CloneRepoArgs): Promise<CloneResult> {
  const { url, targetDir, provider, token, username, timeoutMs, signal, branch } = args;

  let baseArgs: string[];
  let childEnv: Record<string, string>;
  try {
    ({ baseArgs, childEnv } = buildGitContext(url, provider, token, username));
  } catch {
    return { ok: false, kind: 'clone_failed', error: 'invalid url' };
  }

  const cloneArgs = [...baseArgs, 'clone', '--no-tags', '--progress'];
  if (branch != null && branch.length > 0) {
    cloneArgs.push('--branch', branch);
  }
  cloneArgs.push(url, targetDir);

  const r = await runGit(cloneArgs, {
    env: childEnv,
    timeoutMs,
    signal,
    onStderr: args.onProgress ? makeProgressParser(args.onProgress) : undefined,
  });

  if (r.spawnFailed) return { ok: false, kind: 'clone_failed', error: 'git not found' };
  if (r.timedOut) {
    return { ok: false, kind: 'clone_timeout', error: trimStderr(r.stderr, 'clone timed out') };
  }
  if (r.exitCode !== 0) {
    return { ok: false, kind: 'clone_failed', error: trimStderr(r.stderr, 'clone failed') };
  }
  return { ok: true };
}

export async function testRemote(args: TestRemoteArgs): Promise<{ ok: boolean; error?: string }> {
  const { url, provider, token, username, timeoutMs } = args;

  let baseArgs: string[];
  let childEnv: Record<string, string>;
  try {
    ({ baseArgs, childEnv } = buildGitContext(url, provider, token, username));
  } catch {
    return { ok: false, error: 'invalid url' };
  }

  // ls-remote writes its ref list to stdout, which we never consume — leave
  // stdout ignored (runGit's default) so a large ref list can't fill the OS
  // pipe buffer and stall the exit wait.
  const r = await runGit([...baseArgs, 'ls-remote', '--heads', url], { env: childEnv, timeoutMs });

  if (r.spawnFailed) return { ok: false, error: 'git not found' };
  if (r.exitCode === 0 && !r.timedOut) return { ok: true };
  return {
    ok: false,
    error: trimStderr(r.stderr, r.timedOut ? 'ls-remote timed out' : 'ls-remote failed'),
  };
}
