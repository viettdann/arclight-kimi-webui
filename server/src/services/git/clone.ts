import type { GitProvider } from 'shared/types/git-credentials';
import { buildAuthHeader } from './auth-header';
import { parseCloneUrl } from './url';

export interface CloneRepoArgs {
  url: string;
  targetDir: string;
  provider: GitProvider;
  token: string;
  username?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type CloneResult =
  | { ok: true }
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
function buildGitContext(
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
  const { url, targetDir, provider, token, username, timeoutMs, signal } = args;

  let baseArgs: string[];
  let childEnv: Record<string, string>;
  try {
    ({ baseArgs, childEnv } = buildGitContext(url, provider, token, username));
  } catch {
    return { ok: false, kind: 'clone_failed', error: 'invalid url' };
  }

  const cmd = ['git', ...baseArgs, 'clone', '--no-tags', url, targetDir];

  let proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
  try {
    proc = Bun.spawn({ cmd, env: childEnv, stdout: 'ignore', stderr: 'pipe', stdin: 'ignore' });
  } catch {
    return { ok: false, kind: 'clone_failed', error: 'git not found' };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const onAbort = () => proc.kill();
  signal?.addEventListener('abort', onAbort);

  // Drain stderr concurrently with the exit wait. Reading it only after
  // `proc.exited` resolves would deadlock if git's stderr exceeds the OS pipe
  // buffer (~64KB): the child blocks on write and never exits.
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);

  if (timedOut) {
    return { ok: false, kind: 'clone_timeout', error: trimStderr(stderr, 'clone timed out') };
  }
  if (exitCode !== 0) {
    return { ok: false, kind: 'clone_failed', error: trimStderr(stderr, 'clone failed') };
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

  // ls-remote writes its ref list to stdout, which we never consume — ignore it
  // so a large ref list can't fill the OS pipe buffer and stall `proc.exited`.
  const cmd = ['git', ...baseArgs, 'ls-remote', '--heads', url];

  let proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
  try {
    proc = Bun.spawn({ cmd, env: childEnv, stdout: 'ignore', stderr: 'pipe', stdin: 'ignore' });
  } catch {
    return { ok: false, error: 'git not found' };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  // Drain stderr concurrently with the exit wait to avoid a pipe-buffer deadlock.
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);

  if (exitCode === 0 && !timedOut) {
    return { ok: true };
  }
  return {
    ok: false,
    error: trimStderr(stderr, timedOut ? 'ls-remote timed out' : 'ls-remote failed'),
  };
}
