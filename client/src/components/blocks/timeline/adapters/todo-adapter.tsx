import { ListChecks } from 'lucide-react';
import type { DisplayBlock } from 'shared/types';
import { TodoBlock } from '../../../display-blocks/todo-block';
import type { Adapter, RailRowShape } from '../types';
import { parseArgs, statusOf } from '../types';

export const SetTodoListAdapter: Adapter = (ctx): RailRowShape => {
  // Prefer display block, fall back to args.todos.
  const display = (ctx.result?.displayBlocks ?? []) as DisplayBlock[];
  const fromDisplay = display.find((b) => b.type === 'todo') as
    | Extract<DisplayBlock, { type: 'todo' }>
    | undefined;

  let items = fromDisplay?.items ?? null;
  if (!items) {
    const args = parseArgs(ctx.call);
    if (args && Array.isArray(args.todos)) {
      items = args.todos
        .filter(
          (t): t is { title?: unknown; status?: unknown } => typeof t === 'object' && t !== null,
        )
        .map((t) => ({
          title: typeof t.title === 'string' ? t.title : '',
          status:
            t.status === 'done' || t.status === 'in_progress' || t.status === 'pending'
              ? t.status
              : 'pending',
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
