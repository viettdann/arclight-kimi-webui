import { ChevronDown, ChevronRight, Loader2, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Block } from 'shared/types';
import { BlockRegistry } from './block-registry';

interface SubagentAccordionProps {
  parentToolCallId: string;
  blocks: Block[];
  isStreaming: boolean;
}

export function SubagentAccordion({ blocks, isStreaming }: SubagentAccordionProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Keep open if subagent is currently streaming events
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  const toggleOpen = () => {
    if (!isStreaming) {
      setIsOpen(!isOpen);
    }
  };

  const activityCount = blocks.length;

  return (
    <div className="rounded-xl border border-primary/10 bg-primary/2 shadow-sm backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
      {/* Accordion Toggle Header */}
      <button
        type="button"
        onClick={toggleOpen}
        disabled={isStreaming}
        className={`w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-primary select-none ${
          isStreaming ? 'cursor-default' : 'cursor-pointer hover:bg-primary/5'
        }`}
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="h-4.5 w-4.5 text-primary animate-spin" />
          ) : (
            <UserCog className="h-4.5 w-4.5 text-primary/70 shrink-0" />
          )}
          <span>{isStreaming ? 'Subagent Active...' : 'Subagent Session'}</span>
          <span className="text-[10px] bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded font-mono font-bold">
            {activityCount} {activityCount === 1 ? 'activity' : 'activities'}
          </span>
        </div>

        {!isStreaming && (
          <div>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        )}
      </button>

      {/* Expanded Nested Blocks */}
      {isOpen && (
        <div className="border-t border-primary/10 bg-background/30 pl-4 pr-3 py-3 space-y-4 max-h-[36rem] overflow-y-auto scrollbar-thin">
          {blocks.length === 0 ? (
            <div className="text-[11px] font-medium text-muted-foreground/60 italic py-2 pl-2">
              Waiting for subagent actions...
            </div>
          ) : (
            <div className="border-l border-primary/20 pl-4 space-y-4">
              {blocks.map((block) => (
                <BlockRegistry key={block.id} block={block} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
