import { useLatestTodos } from '../../lib/chat-store';
import { TodoStatusIcon } from '../display-blocks/todo-status-icon';

interface TodoPanelProps {
  sessionId: string | undefined;
}

// Bullet-list glyph for the empty state. Inlined to match the design mark.
function BulletListIcon({ className }: { className?: string }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.73315 11.3333C4.73315 10.9282 4.40476 10.5999 3.99976 10.5999C3.5949 10.6 3.26636 10.9284 3.26636 11.3333C3.26636 11.7382 3.5949 12.0665 3.99976 12.0667C4.40476 12.0667 4.73315 11.7383 4.73315 11.3333ZM13.9333 10.7336V11.9329H8.06714V10.7336H13.9333ZM4.73315 4.66626C4.73298 4.2614 4.40466 3.93286 3.99976 3.93286C3.59501 3.93304 3.26653 4.26151 3.26636 4.66626C3.26636 5.07116 3.5949 5.39948 3.99976 5.39966C4.40476 5.39966 4.73315 5.07127 4.73315 4.66626ZM13.9333 4.06665V5.26685H8.06714V4.06665H13.9333ZM5.93335 11.3333C5.93335 12.401 5.06751 13.2668 3.99976 13.2668C2.93215 13.2667 2.06714 12.4009 2.06714 11.3333C2.06714 10.2656 2.93215 9.39983 3.99976 9.39966C5.06751 9.39966 5.93335 10.2655 5.93335 11.3333ZM5.93335 4.66626C5.93335 5.73401 5.06751 6.59985 3.99976 6.59985C2.93215 6.59968 2.06714 5.7339 2.06714 4.66626C2.06731 3.59877 2.93226 2.73382 3.99976 2.73364C5.0674 2.73364 5.93317 3.59866 5.93335 4.66626Z" />
    </svg>
  );
}

// Read-only mirror of the most recent todo checklist for the active session.
// Reuses the status iconography from the inline todo display block.
export function TodoPanel({ sessionId }: TodoPanelProps) {
  const items = useLatestTodos(sessionId);

  return (
    <div className="space-y-3 p-4">
      <h4 className="text-base font-semibold text-foreground">Todo</h4>
      {!items || items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <BulletListIcon className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">No todos yet</p>
            <p className="text-xs text-muted-foreground">
              Progress for complex tasks will appear here
            </p>
          </div>
        </div>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
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
