import { TodoStatusIcon } from './todo-status-icon';

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
        {items.map((item, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: positional checklist, items keyed by order
            key={index}
            className={`flex items-center gap-3 text-sm transition-colors py-1 ${
              item.status === 'done'
                ? 'text-muted-foreground line-through decoration-muted-foreground/30'
                : 'text-foreground'
            }`}
          >
            <div className="shrink-0">
              <TodoStatusIcon status={item.status} />
            </div>
            <span className="font-medium">{item.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
