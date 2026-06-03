import { Check, Loader2 } from 'lucide-react';
import { parseHarnessTags } from '../../lib/harness-tags';
import { HarnessTagBlock } from './harness-tag-block';

interface UserBlockProps {
  content: string;
  status?: 'pending' | 'sent';
  createdAt: string;
}

export function UserBlock({ content, status, createdAt }: UserBlockProps) {
  const isPending = status === 'pending';
  const segments = parseHarnessTags(content);
  const hasTags = segments.some((s) => s.kind === 'tag');

  return (
    <div className="flex flex-col items-end gap-1.5 w-full animate-in fade-in duration-200">
      <div className="max-w-[85%] w-fit flex flex-col gap-2">
        {hasTags ? (
          segments.map((seg, i) =>
            seg.kind === 'tag' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static parsed segments, never reordered
              <HarnessTagBlock key={i} name={seg.name} content={seg.content} />
            ) : (
              seg.content.trim() && (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: static parsed segments, never reordered
                  key={i}
                  className="rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm font-medium leading-relaxed whitespace-pre-wrap select-text break-words self-end"
                >
                  {seg.content.trim()}
                </div>
              )
            ),
          )
        ) : (
          <div className="rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm font-medium leading-relaxed whitespace-pre-wrap select-text break-words">
            {content}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground select-none font-medium">
        <span>
          {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        ) : (
          <Check className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
      </div>
    </div>
  );
}
