import { FallbackAdapter } from './adapters/fallback-adapter';
import {
  GlobAdapter,
  GrepAdapter,
  ReadFileAdapter,
  ReadMediaAdapter,
  StrReplaceFileAdapter,
  WriteFileAdapter,
} from './adapters/file-adapters';
import { ShellAdapter } from './adapters/shell-adapter';
import {
  ExitPlanModeAdapter,
  TaskListAdapter,
  TaskOutputAdapter,
  TaskStopAdapter,
} from './adapters/task-adapters';
import { ThinkToolAdapter } from './adapters/think-adapter';
import { SetTodoListAdapter } from './adapters/todo-adapter';
import { FetchURLAdapter, SearchWebAdapter } from './adapters/web-adapters';
import type { Adapter } from './types';

/** Tool name → adapter. Names match kimi-cli built-in tools. */
const REGISTRY: Record<string, Adapter> = {
  ReadFile: ReadFileAdapter,
  ReadMediaFile: ReadMediaAdapter,
  Glob: GlobAdapter,
  Grep: GrepAdapter,
  WriteFile: WriteFileAdapter,
  StrReplaceFile: StrReplaceFileAdapter,
  Shell: ShellAdapter,
  Think: ThinkToolAdapter,
  SetTodoList: SetTodoListAdapter,
  SearchWeb: SearchWebAdapter,
  FetchURL: FetchURLAdapter,
  TaskList: TaskListAdapter,
  TaskOutput: TaskOutputAdapter,
  TaskStop: TaskStopAdapter,
  ExitPlanMode: ExitPlanModeAdapter,
};

export function adapterFor(name: string): Adapter {
  return REGISTRY[name] ?? FallbackAdapter;
}

/** Public verb shown in the auto-collapse summary; aggregates by verb category. */
export const SUMMARY_VERB: Record<string, string> = {
  WriteFile: 'Created',
  StrReplaceFile: 'Edited',
  SetTodoList: 'Updated Todos',
  Shell: 'Ran command',
  Glob: 'Searched',
  Grep: 'Searched',
  SearchWeb: 'Searched web',
  FetchURL: 'Fetched',
  ReadFile: 'Read',
  ReadMediaFile: 'Read media',
  Think: 'Thought',
  TaskList: 'Listed tasks',
  TaskOutput: 'Read task output',
  TaskStop: 'Stopped task',
  ExitPlanMode: 'Exited plan mode',
};
