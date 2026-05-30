import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents as components, MarkdownStreamingContext } from './markdown';

interface TextBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function TextBlock({ content, isStreaming }: TextBlockProps) {
  return (
    <div className="flex flex-col gap-2 w-full max-w-none">
      <MarkdownStreamingContext.Provider value={!!isStreaming}>
        <div className="space-y-2 select-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-flex items-center gap-1.5 ml-1 text-primary select-none font-medium text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="animate-pulse">Assistant typing...</span>
            </span>
          )}
        </div>
      </MarkdownStreamingContext.Provider>
    </div>
  );
}
