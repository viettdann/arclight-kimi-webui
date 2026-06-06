import { AskUserQuestionAdapter } from './adapters/askuserquestion-adapter';
import {
  EditFileAdapter,
  MultiEditFileAdapter,
  NotebookEditAdapter,
} from './adapters/edit-adapters';
import { FallbackAdapter } from './adapters/fallback-adapter';
import {
  GlobAdapter,
  GrepAdapter,
  ReadFileAdapter,
  WriteFileAdapter,
} from './adapters/file-adapters';
import { BashOutputAdapter, KillShellAdapter, ShellAdapter } from './adapters/shell-adapter';
import { TaskAdapter } from './adapters/task-adapters';
import { SetTodoListAdapter } from './adapters/todo-adapter';
import { FetchURLAdapter, SearchWebAdapter } from './adapters/web-adapters';
import { WorkflowAdapter } from './adapters/workflow-adapter';
import type { Adapter } from './types';

/** Tool name → adapter. Names match Claude Agent SDK built-in tools. */
const REGISTRY: Record<string, Adapter> = {
  Read: ReadFileAdapter,
  Write: WriteFileAdapter,
  Edit: EditFileAdapter,
  MultiEdit: MultiEditFileAdapter,
  NotebookEdit: NotebookEditAdapter,
  Glob: GlobAdapter,
  Grep: GrepAdapter,
  Bash: ShellAdapter,
  BashOutput: BashOutputAdapter,
  KillShell: KillShellAdapter,
  TodoWrite: SetTodoListAdapter,
  WebSearch: SearchWebAdapter,
  WebFetch: FetchURLAdapter,
  Task: TaskAdapter,
  Workflow: WorkflowAdapter,
  AskUserQuestion: AskUserQuestionAdapter,
};

export function adapterFor(name: string): Adapter {
  return REGISTRY[name] ?? FallbackAdapter;
}

/** Public verb shown in the auto-collapse summary; aggregates by verb category. */
export const SUMMARY_VERB: Record<string, string> = {
  Write: 'Created',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  NotebookEdit: 'Edited',
  TodoWrite: 'Updated Todos',
  Bash: 'Ran command',
  BashOutput: 'Read output',
  KillShell: 'Killed shell',
  Glob: 'Searched',
  Grep: 'Searched',
  WebSearch: 'Searched web',
  WebFetch: 'Fetched',
  Read: 'Read',
  Task: 'Delegated',
  Workflow: 'Orchestrated',
  AskUserQuestion: 'Asked',
  // Native thinking blocks aggregate under the synthetic "Think" key.
  Think: 'Thought',
};
