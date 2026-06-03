import { TerminalSquare } from 'lucide-react';
import { TerminalOutput } from '../terminal-output';
import type { Adapter } from '../types';
import { readArgString, statusOf } from '../types';

const INLINE_PREVIEW = 60;

export const ShellAdapter: Adapter = (ctx) => {
  const command = readArgString(ctx.call, 'command');
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
    verb: 'Command executed',
    inline: inlineCmd ? (
      <span className="font-mono text-muted-foreground/75">{inlineCmd}</span>
    ) : undefined,
    detail,
    status,
  };
};
