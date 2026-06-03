import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

interface TodoItem {
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

interface TodoBlockProps {
  items: TodoItem[];
}

export function TodoBlock({ items }: TodoBlockProps) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 shadow-sm backdrop-blur-sm space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Task Checklist
      </h4>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const isDone = item.status === 'done';
          const isInProgress = item.status === 'in_progress';

          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: positional checklist, items keyed by order
              key={index}
              className={`flex items-center gap-3 text-sm transition-colors py-1 ${
                isDone
                  ? 'text-muted-foreground line-through decoration-muted-foreground/30'
                  : 'text-foreground'
              }`}
            >
              <div className="shrink-0">
                {isDone ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 fill-emerald-500/10" />
                ) : isInProgress ? (
                  <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/50" />
                )}
              </div>
              <span className="font-medium">{item.title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
