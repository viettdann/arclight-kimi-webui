import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseHarnessTags } from '../../lib/harness-tags';
import { HarnessTagBlock } from './harness-tag-block';
import { markdownComponents as components } from './markdown';

interface TextBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function TextBlock({ content, isStreaming }: TextBlockProps) {
  const segments = parseHarnessTags(content);
  const hasTags = segments.some((s) => s.kind === 'tag');

  return (
    <div className="flex flex-col gap-2 w-full max-w-none">
      <div className="space-y-2 select-text">
        {hasTags ? (
          segments.map((seg, i) =>
            seg.kind === 'tag' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static parsed segments, never reordered
              <HarnessTagBlock key={i} name={seg.name} content={seg.content} />
            ) : (
              seg.content.trim() && (
                // biome-ignore lint/suspicious/noArrayIndexKey: static parsed segments, never reordered
                <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
                  {seg.content}
                </ReactMarkdown>
              )
            ),
          )
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        )}
        {isStreaming && (
          <span className="inline-flex items-center gap-1.5 ml-1 text-primary select-none font-medium text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="animate-pulse">Assistant typing...</span>
          </span>
        )}
      </div>
    </div>
  );
}
