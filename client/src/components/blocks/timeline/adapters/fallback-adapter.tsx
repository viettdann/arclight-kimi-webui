import { Box } from 'lucide-react';
import { FallbackDetail } from '../fallback-detail';
import type { Adapter } from '../types';
import { statusOf } from '../types';

export const FallbackAdapter: Adapter = (ctx) => ({
  icon: <Box className="h-3.5 w-3.5" />,
  verb: 'Used',
  inline: (
    <span className="font-mono bg-muted/60 border border-border/80 px-1.5 py-0.5 rounded text-[10px] text-primary">
      {ctx.call.name}
    </span>
  ),
  detail: (
    <FallbackDetail
      args={ctx.call.args ?? ctx.call.argsStreaming}
      output={ctx.result?.output}
      message={ctx.result?.message ?? null}
    />
  ),
  status: statusOf(ctx),
});
