const defaultGitEnv = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  GIT_TERMINAL_PROMPT: '0',
});

export interface RunGitOptions {
  /** Working directory for the git process (Bun.spawn `cwd`). */
  cwd?: string;
  /**
   * Full child env. Defaults to `process.env` + `GIT_TERMINAL_PROMPT=0`.
   * Callers that inject credentials (clone/ls-remote) pass a fully-built env so
   * the token rides an out-of-band header instead of argv.
   */
  env?: Record<string, string>;
  timeoutMs: number;
  /** Kill the process when this signal fires, in addition to the timeout. */
  signal?: AbortSignal;
  /**
   * Pipe + drain stdout into the result. When false (default) stdout is sent to
   * /dev/null so large output (e.g. an `ls-remote` ref list) can't fill the OS
   * pipe buffer and stall `proc.exited`.
   */
  captureStdout?: boolean;
  /**
   * Called with each decoded stderr chunk as it arrives, alongside the full
   * drain. Lets callers stream live progress (git writes `--progress` to stderr
   * using `\r`) without waiting for the process to exit. The complete stderr is
   * still accumulated and returned in `GitRunResult.stderr`.
   */
  onStderr?: (chunk: string) => void;
}

// Read a stream to completion, invoking `onChunk` with each decoded piece while
// also accumulating the full text. Mirrors `new Response(stream).text()` but
// surfaces partial output as it streams in.
async function drainWithCallback(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) {
        full += text;
        onChunk(text);
      }
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      full += tail;
      onChunk(tail);
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

export interface GitRunResult {
  /** Process exit code, or -1 when the spawn itself failed. */
  exitCode: number;
  /** Drained stdout, or '' when `captureStdout` is false / the spawn failed. */
  stdout: string;
  /** Drained stderr, or '' when the spawn failed. */
  stderr: string;
  /** True when the timeout fired and the process was killed. */
  timedOut: boolean;
  /** True when `Bun.spawn` threw (git binary missing, etc). */
  spawnFailed: boolean;
}

/**
 * Run `git <args>` as a child process with a hard timeout, draining stderr (and
 * optionally stdout) concurrently with the exit wait so a full OS pipe buffer
 * can never deadlock the child. This is the single spawn/timeout/drain
 * implementation shared by clone, ls-remote, and repo inspection.
 *
 * Never throws: a spawn failure returns `{ exitCode: -1, spawnFailed: true }`,
 * a timeout sets `timedOut`. Callers map these to their own result shapes.
 */
export async function runGit(args: string[], opts: RunGitOptions): Promise<GitRunResult> {
  const captureStdout = opts.captureStdout ?? false;

  let proc: Bun.Subprocess<'ignore', 'pipe' | 'ignore', 'pipe'>;
  try {
    proc = Bun.spawn({
      cmd: ['git', ...args],
      cwd: opts.cwd,
      env: opts.env ?? defaultGitEnv(),
      stdin: 'ignore',
      stdout: captureStdout ? 'pipe' : 'ignore',
      stderr: 'pipe',
    });
  } catch {
    return { exitCode: -1, stdout: '', stderr: '', timedOut: false, spawnFailed: true };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs);
  const onAbort = () => proc.kill();
  opts.signal?.addEventListener('abort', onAbort);

  // Drain both pipes alongside the exit wait. Reading them only after
  // `proc.exited` resolves would deadlock once git's output exceeds the OS pipe
  // buffer (~64KB): the child blocks on write and never exits.
  const stdoutP: Promise<string> = captureStdout
    ? new Response(proc.stdout as ReadableStream<Uint8Array>).text()
    : Promise.resolve('');
  const stderrP: Promise<string> = opts.onStderr
    ? drainWithCallback(proc.stderr as ReadableStream<Uint8Array>, opts.onStderr)
    : new Response(proc.stderr).text();
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutP, stderrP]);

  clearTimeout(timer);
  opts.signal?.removeEventListener('abort', onAbort);

  return { exitCode, stdout, stderr, timedOut, spawnFailed: false };
}
