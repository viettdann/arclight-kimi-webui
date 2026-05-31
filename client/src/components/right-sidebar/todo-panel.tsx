import { useLatestTodos } from '../../lib/chat-store';
import { TodoStatusIcon } from '../display-blocks/todo-status-icon';

interface TodoPanelProps {
  sessionId: string | undefined;
}

// Read-only mirror of the most recent todo checklist for the active session.
// Reuses the status iconography from the inline todo display block.
export function TodoPanel({ sessionId }: TodoPanelProps) {
  const items = useLatestTodos(sessionId);

  return (
    <div className="space-y-3 p-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Todos
      </h4>
      {!items || items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No todos yet</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: positional checklist, items keyed by order
              key={index}
              className={`flex items-start gap-2.5 text-sm transition-colors ${
                item.status === 'done'
                  ? 'text-muted-foreground line-through decoration-muted-foreground/30'
                  : 'text-foreground'
              }`}
            >
              <div className="shrink-0 pt-0.5">
                <TodoStatusIcon status={item.status} className="h-4 w-4" />
              </div>
              <span className="min-w-0 font-medium break-words">{item.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
