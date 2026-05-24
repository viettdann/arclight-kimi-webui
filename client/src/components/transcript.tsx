import { Sparkles, Terminal } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { useSessionChat } from '../lib/chat-store';
import { BlockRegistry } from './blocks/block-registry';

export function Transcript() {
  const { id: sessionId } = useParams<{ id: string }>();
  const session = useSessionChat(sessionId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  const blocks = session?.blocks || [];
  const isTurnInProgress = session?.isTurnInProgress || false;

  // Auto-scroll to bottom during active turn updates
  useEffect(() => {
    if (isTurnInProgress || blocks.length > 0) {
      bottomAnchorRef.current?.scrollIntoView({
        behavior: isTurnInProgress ? 'smooth' : 'auto',
      });
    }
  }, [blocks.length, isTurnInProgress]);

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center p-8 select-none">
        <div className="rounded-2xl bg-muted/40 p-4 border border-border/80 shadow-sm animate-pulse mb-4">
          <Terminal className="h-10 w-10 text-primary/40" />
        </div>
        <h3 className="text-sm font-semibold text-foreground/80">No active session</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Select or create a project from the sidebar to launch a coding task.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 select-none">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-ping" />
          <span>Loading session data...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scrollbar-thin select-none"
    >
      <div className="mx-auto max-w-3xl space-y-6 pb-24">
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center pt-24 pb-8 select-none">
            <div className="rounded-full bg-primary/10 p-3 border border-primary/20 shadow-sm text-primary mb-4 animate-bounce">
              <Sparkles className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground/95">Session initialized</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">
              Ask anything to get started. The agent will run shell commands, write files, and show
              rich previews.
            </p>
          </div>
        ) : (
          blocks.map((block) => <BlockRegistry key={block.id} block={block} />)
        )}
        <div ref={bottomAnchorRef} />
      </div>
    </div>
  );
}
