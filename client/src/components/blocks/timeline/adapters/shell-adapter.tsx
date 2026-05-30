import { OctagonX, ScrollText, TerminalSquare } from 'lucide-react';
import { TerminalOutput } from '../terminal-output';
import type { Adapter } from '../types';
import { parseArgs, readArgString, statusOf } from '../types';

const INLINE_PREVIEW = 60;

/** Claude `Bash` — `command`, `description`, `run_in_background`. */
export const ShellAdapter: Adapter = (ctx) => {
  const command = readArgString(ctx.call, 'command');
  const background = parseArgs(ctx.call)?.run_in_background === true;
  const inlineCmd =
    command.length > INLINE_PREVIEW ? `${command.slice(0, INLINE_PREVIEW)}…` : command;
  const status = statusOf(ctx);
  const output = typeof ctx.result?.output === 'string' ? ctx.result.output : '';
  // Always show terminal block, even when streaming (shows `$ command` placeholder).
  const detail = command ? (
    <TerminalOutput command={command} output={output} isError={status === 'error'} />
  ) : undefined;
  return {
    icon: <TerminalSquare className="h-3.5 w-3.5" />,
    verb: background ? 'Ran command in background' : 'Ran command',
    inline: inlineCmd ? (
      <span className="font-mono text-muted-foreground/75">{inlineCmd}</span>
    ) : undefined,
    detail,
    status,
  };
};

/** Claude `BashOutput` — `bash_id`. Reads stdout/stderr of a background shell. */
export const BashOutputAdapter: Adapter = (ctx) => {
  const bashId = readArgString(ctx.call, 'bash_id');
  const status = statusOf(ctx);
  const output = typeof ctx.result?.output === 'string' ? ctx.result.output : '';
  return {
    icon: <ScrollText className="h-3.5 w-3.5" />,
    verb: 'Read output',
    inline: bashId ? (
      <span className="font-mono text-muted-foreground/75">{bashId}</span>
    ) : undefined,
    detail:
      status !== 'running' && output ? (
        <TerminalOutput output={output} isError={status === 'error'} />
      ) : undefined,
    status,
  };
};

/** Claude `KillShell` — `shell_id`. Terminates a background shell. */
export const KillShellAdapter: Adapter = (ctx) => {
  const shellId = readArgString(ctx.call, 'shell_id');
  return {
    icon: <OctagonX className="h-3.5 w-3.5" />,
    verb: 'Killed shell',
    inline: shellId ? (
      <span className="font-mono text-muted-foreground/75">{shellId}</span>
    ) : undefined,
    status: statusOf(ctx),
  };
};
