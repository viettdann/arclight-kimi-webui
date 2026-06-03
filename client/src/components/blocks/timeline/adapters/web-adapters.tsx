import { Globe, Link as LinkIcon } from 'lucide-react';
import type { Adapter } from '../types';
import { parseArgs, readArgString, statusOf } from '../types';

export const SearchWebAdapter: Adapter = (ctx) => {
  const args = parseArgs(ctx.call);
  const query =
    (args && typeof args.query === 'string' && args.query) ||
    (args && typeof args.q === 'string' && args.q) ||
    '';
  const output = typeof ctx.result?.output === 'string' ? ctx.result.output : '';
  const status = statusOf(ctx);
  return {
    icon: <Globe className="h-3.5 w-3.5" />,
    verb: 'Searched web',
    inline: query ? <span className="font-mono text-muted-foreground/75">{query}</span> : undefined,
    detail:
      status !== 'running' && output ? (
        <div className="rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] text-muted-foreground/95 max-h-56 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words select-text">
          {output}
        </div>
      ) : undefined,
    status,
  };
};

export const FetchURLAdapter: Adapter = (ctx) => {
  const url = readArgString(ctx.call, 'url');
  const output = typeof ctx.result?.output === 'string' ? ctx.result.output : '';
  const status = statusOf(ctx);
  return {
    icon: <LinkIcon className="h-3.5 w-3.5" />,
    verb: 'Fetched',
    inline: url ? (
      <span className="font-mono text-muted-foreground/75 truncate max-w-[28rem] inline-block align-middle">
        {url}
      </span>
    ) : undefined,
    detail:
      status !== 'running' && output ? (
        <div className="rounded-md border border-border/60 bg-muted/15 p-2 font-mono text-[11px] text-muted-foreground/95 max-h-56 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words select-text">
          {output.slice(0, 4000)}
          {output.length > 4000 && '…'}
        </div>
      ) : undefined,
    status,
  };
};
