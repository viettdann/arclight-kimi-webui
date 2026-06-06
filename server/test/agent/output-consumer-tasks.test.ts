import { describe, expect, it, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/session-manager';

// The consumer's only external emit path is broadcastEvent — capture it.
type Broadcast = { type: string; payload: Record<string, unknown> };
const broadcasts: Broadcast[] = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload: (payload ?? {}) as Record<string, unknown> });
    return { type, payload };
  },
}));

// Title settle / sdkSessionId persistence are out of scope here — the messages
// fed below carry no session_id (captureSessionId stays a no-op) and never reach
// a `result`, so maybePersistTitle never runs. Stub the DB to satisfy imports.
const dbFactory = () => ({
  db: {
    query: {
      sessions: { findFirst: async () => ({ title: 'preset', titleSource: 'manual' }) },
    },
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
  schema: { sessions: {} },
});
mock.module('../../src/db', dbFactory);
mock.module('../../src/db/index', dbFactory);

const { consumeQueryOutput } = await import('../../src/services/agent/output-consumer');
const { SessionManager } = await import('../../src/services/session-manager');

/** An async-iterable query that just replays a fixed message list. */
function makeQuery(messages: unknown[]): ActiveSession['query'] {
  return (async function* () {
    for (const m of messages) yield m;
  })() as unknown as ActiveSession['query'];
}

function makeActive(sessionId: string): ActiveSession {
  const sm = new SessionManager();
  return sm.register({ sessionId, userId: 'u1', workDir: '/tmp/w', approvalMode: 'ask' });
}

// Minimal system task message builders mirroring the SDK wire shapes.
function taskStarted(over: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype: 'task_started', uuid: 'u', ...over };
}
function taskProgress(over: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype: 'task_progress', uuid: 'u', ...over };
}
function taskUpdated(over: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype: 'task_updated', uuid: 'u', ...over };
}
function taskNotification(over: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype: 'task_notification', uuid: 'u', ...over };
}

describe('consumeQueryOutput — workflow run / child task events', () => {
  it('emits a top-level task_started for a run flagged by task_type local_workflow (no subagent_event)', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-run-tt');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-1',
        tool_use_id: 'toolu_wf',
        description: 'run the spec workflow',
        task_type: 'local_workflow',
        workflow_name: 'spec',
        prompt: 'do the thing',
      }),
    ]);

    await consumeQueryOutput(active);

    const started = broadcasts.filter((b) => b.type === 'task_started');
    expect(started).toHaveLength(1);
    expect(started[0]?.payload).toEqual({
      taskId: 'run-1',
      toolCallId: 'toolu_wf',
      description: 'run the spec workflow',
      taskType: 'local_workflow',
      workflowName: 'spec',
      prompt: 'do the thing',
    });
    // A run never produces the legacy subagent_event frame.
    expect(broadcasts.some((b) => b.type === 'subagent_event')).toBe(false);
  });

  it('treats a task with only a workflow_name (no task_type) as a run', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-run-wn');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-2',
        tool_use_id: 'toolu_wf2',
        description: 'named workflow',
        workflow_name: 'review',
      }),
    ]);

    await consumeQueryOutput(active);

    const started = broadcasts.filter((b) => b.type === 'task_started');
    expect(started).toHaveLength(1);
    expect(started[0]?.payload).toMatchObject({
      taskId: 'run-2',
      toolCallId: 'toolu_wf2',
      workflowName: 'review',
    });
    // No task_type was supplied → it is omitted from the payload.
    expect(started[0]?.payload.taskType).toBeUndefined();
    expect(broadcasts.some((b) => b.type === 'subagent_event')).toBe(false);
  });

  it('attributes a child task_started (same tool_use_id as the run) top-level', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-child');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-3',
        tool_use_id: 'toolu_wf3',
        description: 'run',
        task_type: 'local_workflow',
        workflow_name: 'spec',
      }),
      taskStarted({
        task_id: 'child-A',
        tool_use_id: 'toolu_wf3',
        description: 'child step',
        subagent_type: 'general-purpose',
      }),
    ]);

    await consumeQueryOutput(active);

    const started = broadcasts.filter((b) => b.type === 'task_started');
    expect(started).toHaveLength(2);
    // The child carries the run's toolCallId so it folds under the same block.
    expect(started[1]?.payload).toEqual({
      taskId: 'child-A',
      toolCallId: 'toolu_wf3',
      description: 'child step',
    });
    expect(broadcasts.some((b) => b.type === 'subagent_event')).toBe(false);
  });

  it('emits task_progress with camelCase usage for a tracked task id and skips untracked ids', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-progress');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-4',
        tool_use_id: 'toolu_wf4',
        description: 'run',
        task_type: 'local_workflow',
      }),
      taskStarted({ task_id: 'child-B', tool_use_id: 'toolu_wf4', description: 'child' }),
      // Tracked child progress.
      taskProgress({
        task_id: 'child-B',
        description: 'working',
        subagent_type: 'general-purpose',
        usage: { total_tokens: 1234, tool_uses: 5, duration_ms: 9000 },
        last_tool_name: 'Bash',
        summary: 'halfway',
      }),
      // Untracked progress — no run owns task id 'unknown-task' → skipped.
      taskProgress({
        task_id: 'unknown-task',
        description: 'ghost',
        usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
      }),
    ]);

    await consumeQueryOutput(active);

    const progress = broadcasts.filter((b) => b.type === 'task_progress');
    expect(progress).toHaveLength(1);
    expect(progress[0]?.payload).toEqual({
      taskId: 'child-B',
      toolCallId: 'toolu_wf4',
      description: 'working',
      subagentType: 'general-purpose',
      usage: { totalTokens: 1234, toolUses: 5, durationMs: 9000 },
      lastToolName: 'Bash',
      summary: 'halfway',
    });
  });

  it('emits task_updated mapping is_backgrounded→isBackgrounded for a tracked id; skips untracked', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-updated');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-5',
        tool_use_id: 'toolu_wf5',
        description: 'run',
        task_type: 'local_workflow',
      }),
      // Run's own task_updated (run task id is tracked via the map).
      taskUpdated({
        task_id: 'run-5',
        patch: {
          status: 'running',
          description: 'now running',
          error: 'transient',
          is_backgrounded: true,
          // Fields not on TaskUpdatedPayload.patch are dropped.
          end_time: 123,
          total_paused_ms: 4,
        },
      }),
      // Untracked task_updated → skipped (no run owns it).
      taskUpdated({ task_id: 'ghost', patch: { status: 'failed' } }),
    ]);

    await consumeQueryOutput(active);

    const updated = broadcasts.filter((b) => b.type === 'task_updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]?.payload).toEqual({
      taskId: 'run-5',
      patch: {
        status: 'running',
        description: 'now running',
        error: 'transient',
        isBackgrounded: true,
      },
    });
  });

  it('emits a top-level task_notification and clears the run so a later same-id child is no longer attributed', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-notify');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-6',
        tool_use_id: 'toolu_wf6',
        description: 'run',
        task_type: 'local_workflow',
      }),
      // The run's OWN terminal notification (task_id == run task id) ends the run.
      taskNotification({
        task_id: 'run-6',
        tool_use_id: 'toolu_wf6',
        status: 'completed',
        output_file: '/tmp/out',
        summary: 'all done',
        usage: { total_tokens: 50, tool_uses: 2, duration_ms: 3000 },
      }),
      // Same tool_use_id reused AFTER the run ended → no longer a child, so this
      // falls through to the plain-subagent path (subagent_event), not task_started.
      taskStarted({ task_id: 'late-child', tool_use_id: 'toolu_wf6', description: 'orphan' }),
    ]);

    await consumeQueryOutput(active);

    const notif = broadcasts.filter((b) => b.type === 'task_notification');
    expect(notif).toHaveLength(1);
    expect(notif[0]?.payload).toEqual({
      taskId: 'run-6',
      toolCallId: 'toolu_wf6',
      status: 'completed',
      summary: 'all done',
      usage: { totalTokens: 50, toolUses: 2, durationMs: 3000 },
    });

    // The run was cleared: the later same-id task_started is NOT a top-level
    // child task_started — it routes to the legacy subagent_event path instead.
    const started = broadcasts.filter((b) => b.type === 'task_started');
    expect(started).toHaveLength(1); // only the run itself, never the orphan
    const subagentEvents = broadcasts.filter((b) => b.type === 'subagent_event');
    expect(subagentEvents).toHaveLength(1);
    expect(subagentEvents[0]?.payload.parentToolCallId).toBe('toolu_wf6');
  });

  it('omits usage on a child notification that carries none', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-notify-nousage');
    active.query = makeQuery([
      taskStarted({
        task_id: 'run-7',
        tool_use_id: 'toolu_wf7',
        description: 'run',
        task_type: 'local_workflow',
      }),
      taskStarted({ task_id: 'child-C', tool_use_id: 'toolu_wf7', description: 'child' }),
      // Child notification with no usage field.
      taskNotification({
        task_id: 'child-C',
        tool_use_id: 'toolu_wf7',
        status: 'failed',
        output_file: '/tmp/out',
        summary: 'child failed',
      }),
    ]);

    await consumeQueryOutput(active);

    const notif = broadcasts.filter((b) => b.type === 'task_notification');
    expect(notif).toHaveLength(1);
    expect(notif[0]?.payload).toEqual({
      taskId: 'child-C',
      toolCallId: 'toolu_wf7',
      status: 'failed',
      summary: 'child failed',
    });
    expect(notif[0]?.payload.usage).toBeUndefined();
  });
});

describe('consumeQueryOutput — plain subagent task regression (legacy subagent_event)', () => {
  it('keeps the legacy subagent_event path for a plain (non-workflow) task_started', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-plain-start');
    active.query = makeQuery([
      // No task_type, no workflow_name, and no active run owns this tool_use_id.
      taskStarted({
        task_id: 'plain-1',
        tool_use_id: 'toolu_task',
        description: 'explore the repo',
        subagent_type: 'Explore',
      }),
    ]);

    await consumeQueryOutput(active);

    // No top-level workflow events.
    expect(broadcasts.some((b) => b.type === 'task_started')).toBe(false);
    const subagentEvents = broadcasts.filter((b) => b.type === 'subagent_event');
    expect(subagentEvents).toHaveLength(1);
    expect(subagentEvents[0]?.payload).toEqual({
      parentToolCallId: 'toolu_task',
      subagentType: 'Explore',
      description: 'explore the repo',
      inner: null,
    });
  });

  it('keeps the legacy synthetic turn_end subagent_event for a plain task_notification', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-plain-notify');
    active.query = makeQuery([
      taskStarted({
        task_id: 'plain-2',
        tool_use_id: 'toolu_task2',
        description: 'explore',
        subagent_type: 'Explore',
      }),
      // task_id is NOT tracked as a workflow run/child → legacy path.
      taskNotification({
        task_id: 'plain-2',
        tool_use_id: 'toolu_task2',
        status: 'completed',
        output_file: '/tmp/out',
        summary: 'subagent done',
      }),
    ]);

    await consumeQueryOutput(active);

    expect(broadcasts.some((b) => b.type === 'task_notification')).toBe(false);
    const subagentEvents = broadcasts.filter((b) => b.type === 'subagent_event');
    // task_started → header-only subagent_event; task_notification → synthetic turn_end.
    expect(subagentEvents).toHaveLength(2);
    expect(subagentEvents[1]?.payload).toEqual({
      parentToolCallId: 'toolu_task2',
      inner: { type: 'turn_end', payload: { status: 'finished', steps: 0 } },
    });
  });

  it('skips a plain (non-workflow) task_progress / task_updated entirely', async () => {
    broadcasts.length = 0;
    const active = makeActive('s-plain-skip');
    active.query = makeQuery([
      // No run ever started → these task ids are untracked.
      taskProgress({
        task_id: 'plain-3',
        description: 'progress',
        usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
      }),
      taskUpdated({ task_id: 'plain-3', patch: { status: 'running' } }),
    ]);

    await consumeQueryOutput(active);

    expect(broadcasts.some((b) => b.type === 'task_progress')).toBe(false);
    expect(broadcasts.some((b) => b.type === 'task_updated')).toBe(false);
    expect(broadcasts.some((b) => b.type === 'subagent_event')).toBe(false);
    expect(broadcasts).toHaveLength(0);
  });
});
