import { ListChecks } from 'lucide-react';
import type { DisplayBlock } from 'shared/types';
import { TodoBlock } from '../../../display-blocks/todo-block';
import type { Adapter, RailRowShape } from '../types';
import { parseArgs, statusOf } from '../types';

type TodoStatus = 'pending' | 'in_progress' | 'done';

/** Map a Claude todo status to the display/`TodoBlock` shape (`completed` → `done`). */
function toTodoStatus(s: unknown): TodoStatus {
  if (s === 'in_progress') return 'in_progress';
  if (s === 'done' || s === 'completed') return 'done';
  return 'pending';
}

/** Claude `TodoWrite` — `todos[{ content, status, activeForm }]`. */
export const SetTodoListAdapter: Adapter = (ctx): RailRowShape => {
  // Prefer the server-built display block; fall back to raw args.todos.
  const display = (ctx.result?.displayBlocks ?? []) as DisplayBlock[];
  const fromDisplay = display.find((b) => b.type === 'todo') as
    | Extract<DisplayBlock, { type: 'todo' }>
    | undefined;

  let items: { title: string; status: TodoStatus }[] | null = fromDisplay?.items ?? null;
  if (!items) {
    const args = parseArgs(ctx.call);
    if (args && Array.isArray(args.todos)) {
      items = args.todos
        .filter(
          (t): t is { content?: unknown; status?: unknown } => typeof t === 'object' && t !== null,
        )
        .map((t) => ({
          // Claude uses `content` (display) + `activeForm` (in-progress phrasing).
          title: typeof t.content === 'string' ? t.content : '',
          status: toTodoStatus(t.status),
        }));
    }
  }

  return {
    icon: <ListChecks className="h-3.5 w-3.5" />,
    verb: 'Updated Todos',
    detail: items && items.length > 0 ? <TodoBlock items={items} /> : undefined,
    status: statusOf(ctx),
  };
};
