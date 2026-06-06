import { describe, expect, it } from 'bun:test';
import type { Block } from 'shared/types';
import { renderTranscript } from '../../src/services/agent/transcript-render';

// task_* events are persisted as `type:'system'` JSONL entries. The renderer
// special-cases any `subtype` starting `task_` BEFORE the IGNORED_LINE_TYPES
// drop, folding them into a `workflow` block keyed `workflow:${tool_use_id}` and
// anchored after the originating tool_call. This mirrors the live consumer's
// attribution (T8) so a reload reconciles with the live stream.

const TS = '2026-05-30T00:00:00.000Z';

function assistantToolUse(messageId: string, id: string, name: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${messageId}`,
    message: {
      id: messageId,
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input: {} }],
    },
    timestamp: TS,
  });
}

function systemTask(subtype: string, over: Record<string, unknown>): string {
  return JSON.stringify({ type: 'system', subtype, timestamp: TS, ...over });
}

function byKind<K extends Block['kind']>(blocks: Block[], kind: K) {
  return blocks.filter((b): b is Extract<Block, { kind: K }> => b.kind === kind);
}

function workflow(blocks: Block[]) {
  return byKind(blocks, 'workflow');
}

describe('renderTranscript — workflow folding', () => {
  it('builds a workflow block from run + child events, anchored after the tool_call', () => {
    const jsonl = [
      assistantToolUse('msg_A', 'toolu_wf', 'Workflow'),
      systemTask('task_started', {
        task_id: 'run-1',
        tool_use_id: 'toolu_wf',
        description: 'run the spec workflow',
        task_type: 'local_workflow',
        workflow_name: 'spec',
      }),
      systemTask('task_started', {
        task_id: 'child-1',
        tool_use_id: 'toolu_wf',
        description: 'step one',
      }),
      systemTask('task_progress', {
        task_id: 'child-1',
        description: 'working',
        usage: { total_tokens: 100, tool_uses: 3, duration_ms: 2000 },
        last_tool_name: 'Bash',
      }),
      systemTask('task_updated', {
        task_id: 'child-1',
        patch: { status: 'completed' },
      }),
      systemTask('task_notification', {
        task_id: 'run-1',
        tool_use_id: 'toolu_wf',
        status: 'completed',
        output_file: '/tmp/out',
        summary: 'workflow done',
        usage: { total_tokens: 500, tool_uses: 12, duration_ms: 9000 },
      }),
    ].join('\n');

    const blocks = renderTranscript(jsonl);
    const wf = workflow(blocks);
    expect(wf).toHaveLength(1);
    const w = wf[0]!;
    expect(w.id).toBe('workflow:toolu_wf');
    expect(w.toolCallId).toBe('toolu_wf');
    expect(w.runId).toBe('run-1');
    expect(w.workflowName).toBe('spec');
    // Run terminal notification settled status + summary + usage.
    expect(w.status).toBe('completed');
    expect(w.summary).toBe('workflow done');
    expect(w.usage).toEqual({ totalTokens: 500, toolUses: 12, durationMs: 9000 });

    // The child was folded with progress + completed status. task_progress
    // refreshes the child description from its non-empty `description` field
    // (mirrors the live consumer), so 'working' overrides the start's 'step one'.
    expect(w.children).toHaveLength(1);
    const child = w.children[0]!;
    expect(child.taskId).toBe('child-1');
    expect(child.description).toBe('working');
    expect(child.status).toBe('completed');
    expect(child.lastToolName).toBe('Bash');
    expect(child.usage).toEqual({ totalTokens: 100, toolUses: 3, durationMs: 2000 });

    // Anchored immediately AFTER the matching tool_call block.
    const callIdx = blocks.findIndex((b) => b.kind === 'tool_call' && b.id === 'toolu_wf');
    const wfIdx = blocks.findIndex((b) => b.kind === 'workflow');
    expect(wfIdx).toBe(callIdx + 1);
  });

  it('maps a killed run status to stopped (task_updated)', () => {
    const jsonl = [
      assistantToolUse('msg_A', 'toolu_k', 'Workflow'),
      systemTask('task_started', {
        task_id: 'run-k',
        tool_use_id: 'toolu_k',
        description: 'run',
        task_type: 'local_workflow',
      }),
      systemTask('task_updated', { task_id: 'run-k', patch: { status: 'killed' } }),
    ].join('\n');

    const w = workflow(renderTranscript(jsonl))[0]!;
    expect(w.status).toBe('stopped');
  });

  it('maps a killed child status to failed (task_updated)', () => {
    const jsonl = [
      assistantToolUse('msg_A', 'toolu_kc', 'Workflow'),
      systemTask('task_started', {
        task_id: 'run-kc',
        tool_use_id: 'toolu_kc',
        description: 'run',
        task_type: 'local_workflow',
      }),
      systemTask('task_started', {
        task_id: 'child-kc',
        tool_use_id: 'toolu_kc',
        description: 'c',
      }),
      systemTask('task_updated', { task_id: 'child-kc', patch: { status: 'killed' } }),
    ].join('\n');

    const w = workflow(renderTranscript(jsonl))[0]!;
    expect(w.children[0]!.status).toBe('failed');
  });

  it('maps a child stopped notification to failed', () => {
    const jsonl = [
      assistantToolUse('msg_A', 'toolu_sc', 'Workflow'),
      systemTask('task_started', {
        task_id: 'run-sc',
        tool_use_id: 'toolu_sc',
        description: 'run',
        task_type: 'local_workflow',
      }),
      systemTask('task_started', {
        task_id: 'child-sc',
        tool_use_id: 'toolu_sc',
        description: 'c',
      }),
      systemTask('task_notification', {
        task_id: 'child-sc',
        tool_use_id: 'toolu_sc',
        status: 'stopped',
        output_file: '/tmp/out',
        summary: 'child stopped',
      }),
    ].join('\n');

    const w = workflow(renderTranscript(jsonl))[0]!;
    expect(w.children[0]!.status).toBe('failed');
    expect(w.children[0]!.summary).toBe('child stopped');
  });

  it('ignores a paused run status, leaving the run running', () => {
    const jsonl = [
      assistantToolUse('msg_A', 'toolu_p', 'Workflow'),
      systemTask('task_started', {
        task_id: 'run-p',
        tool_use_id: 'toolu_p',
        description: 'run',
        task_type: 'local_workflow',
      }),
      systemTask('task_updated', { task_id: 'run-p', patch: { status: 'paused' } }),
    ].join('\n');

    const w = workflow(renderTranscript(jsonl))[0]!;
    expect(w.status).toBe('running');
  });

  it('appends a workflow block when there is no matching tool_call', () => {
    // A run-start whose tool_use_id has no preceding tool_call still produces a
    // block — appended at the end rather than dropped.
    const jsonl = [
      JSON.stringify({
        type: 'assistant',
        uuid: 'u-x',
        message: { id: 'msg_X', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        timestamp: TS,
      }),
      systemTask('task_started', {
        task_id: 'run-orphan',
        tool_use_id: 'toolu_missing',
        description: 'run',
        task_type: 'local_workflow',
        workflow_name: 'spec',
      }),
    ].join('\n');

    const blocks = renderTranscript(jsonl);
    const wf = workflow(blocks);
    expect(wf).toHaveLength(1);
    expect(wf[0]!.id).toBe('workflow:toolu_missing');
    expect(wf[0]!.status).toBe('running');
    // No tool_call to anchor after → appended last.
    expect(blocks[blocks.length - 1]!.kind).toBe('workflow');
  });

  it('does not create a workflow block for a plain (non-workflow) task_started', () => {
    // A task with no task_type/workflow_name and no active run is a plain
    // subagent — it is NOT folded into a workflow block.
    const jsonl = [
      assistantToolUse('msg_A', 'toolu_task', 'Task'),
      systemTask('task_started', {
        task_id: 'plain-1',
        tool_use_id: 'toolu_task',
        description: 'explore',
        subagent_type: 'Explore',
      }),
    ].join('\n');

    expect(workflow(renderTranscript(jsonl))).toHaveLength(0);
  });
});
