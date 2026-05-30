import { describe, expect, it } from 'bun:test';
import type { Block } from 'shared/types';
import { renderTranscript } from '../../src/services/agent/transcript-render';

// Build one JSONL line. Claude Code splits each assistant content block onto
// its own line, so an assistant line carries an array of exactly one block.
function assistantLine(
  messageId: string,
  block: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${messageId}-${Math.random()}`,
    message: { id: messageId, role: 'assistant', model: 'claude-opus-4-8', content: [block] },
    timestamp: '2026-05-30T00:00:00.000Z',
    ...extra,
  });
}

function userPromptLine(
  uuid: string,
  content: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    message: { role: 'user', content },
    timestamp: '2026-05-30T00:00:01.000Z',
    ...extra,
  });
}

function toolResultLine(
  uuid: string,
  toolUseId: string,
  content: unknown,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
    },
    timestamp: '2026-05-30T00:00:02.000Z',
    ...extra,
  });
}

function byKind<K extends Block['kind']>(blocks: Block[], kind: K) {
  return blocks.filter((b): b is Extract<Block, { kind: K }> => b.kind === kind);
}

describe('renderTranscript', () => {
  it('assigns text/thinking/tool_use ids and matches tool_result by tool_use_id', () => {
    const jsonl = [
      assistantLine('msg_A', { type: 'thinking', thinking: 'pondering', signature: 'sig123' }),
      assistantLine('msg_A', { type: 'text', text: 'Hello there' }),
      assistantLine('msg_A', {
        type: 'tool_use',
        id: 'toolu_001',
        name: 'Bash',
        input: { command: 'ls -la' },
      }),
      toolResultLine('uuid-tr-1', 'toolu_001', 'total 0'),
    ].join('\n');

    const blocks = renderTranscript(jsonl);

    const thinking = byKind(blocks, 'thinking');
    const text = byKind(blocks, 'text');
    const toolCall = byKind(blocks, 'tool_call');
    const toolResult = byKind(blocks, 'tool_result');

    expect(thinking).toHaveLength(1);
    expect(thinking[0]!.id).toBe('msg_A:0');
    expect(thinking[0]!.content).toBe('pondering');
    expect(thinking[0]!.encrypted).toBe(false);

    expect(text).toHaveLength(1);
    expect(text[0]!.id).toBe('msg_A:1');
    expect(text[0]!.content).toBe('Hello there');

    expect(toolCall).toHaveLength(1);
    expect(toolCall[0]!.id).toBe('toolu_001');
    expect(toolCall[0]!.toolCallId).toBe('toolu_001');
    expect(toolCall[0]!.name).toBe('Bash');

    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.id).toBe('toolu_001');
    expect(toolResult[0]!.toolCallId).toBe('toolu_001');
    // toolName resolved from the tool_use seen while walking.
    expect(toolResult[0]!.toolName).toBe('Bash');
    expect(toolResult[0]!.isError).toBe(false);
    // Bash → a shell displayBlock derived from the originating input.
    expect(toolResult[0]!.displayBlocks).toEqual([
      { type: 'shell', command: 'ls -la', language: 'bash' },
    ]);

    // Every block is non-streaming on the reload path, and carries the line ts.
    expect(blocks.every((b) => !('isStreaming' in b) || b.isStreaming === false)).toBe(true);
    expect(text[0]!.createdAt).toBe('2026-05-30T00:00:00.000Z');
  });

  it('marks empty thinking with a signature as encrypted', () => {
    const jsonl = assistantLine('msg_E', {
      type: 'thinking',
      thinking: '',
      signature: 'EqIFsignature',
    });
    const blocks = renderTranscript(jsonl);
    const thinking = byKind(blocks, 'thinking');
    expect(thinking).toHaveLength(1);
    expect(thinking[0]!.encrypted).toBe(true);
    expect(thinking[0]!.content).toBe('');
  });

  it('gives sequential content-block indices within one message.id and resets across ids', () => {
    const jsonl = [
      assistantLine('msg_X', { type: 'thinking', thinking: 't', signature: 's' }),
      assistantLine('msg_X', { type: 'text', text: 'first' }),
      assistantLine('msg_X', {
        type: 'tool_use',
        id: 'toolu_x1',
        name: 'Read',
        input: { file_path: '/a' },
      }),
      // New message.id resets the counter to 0.
      assistantLine('msg_Y', { type: 'text', text: 'second' }),
    ].join('\n');

    const blocks = renderTranscript(jsonl);
    const ids = blocks.map((b) => b.id);
    expect(ids).toContain('msg_X:0'); // thinking
    expect(ids).toContain('msg_X:1'); // text
    expect(ids).toContain('toolu_x1'); // tool_use uses the tool id, not msg_X:2
    expect(ids).toContain('msg_Y:0'); // counter reset for the new message
  });

  it('renders a real user prompt but skips meta / command-wrapper user lines', () => {
    const jsonl = [
      userPromptLine('uuid-real', 'Please refactor the parser'),
      userPromptLine('uuid-meta', 'caveat text', { isMeta: true }),
      userPromptLine('uuid-cmd', '<command-name>/executor</command-name>'),
      userPromptLine('uuid-localcmd', '<local-command-caveat>Caveat</local-command-caveat>'),
    ].join('\n');

    const users = byKind(renderTranscript(jsonl), 'user');
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe('uuid-real');
    expect(users[0]!.content).toBe('Please refactor the parser');
    expect(users[0]!.status).toBe('sent');
  });

  it('flags tool_result errors via is_error===true only', () => {
    const jsonl = [
      assistantLine('msg_T', {
        type: 'tool_use',
        id: 'toolu_err',
        name: 'Bash',
        input: { command: 'false' },
      }),
      assistantLine('msg_T2', {
        type: 'tool_use',
        id: 'toolu_ok',
        name: 'Bash',
        input: { command: 'true' },
      }),
      toolResultLine('uuid-e', 'toolu_err', 'boom', {
        /* line-level */
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'uuid-e2',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_err', content: 'boom', is_error: true },
          ],
        },
        timestamp: '2026-05-30T00:00:03.000Z',
      }),
      // is_error missing ⇒ not an error.
      toolResultLine('uuid-o', 'toolu_ok', 'fine'),
    ].join('\n');

    const results = byKind(renderTranscript(jsonl), 'tool_result');
    const errResult = results.find((r) => r.isError === true);
    const okResults = results.filter((r) => r.toolCallId === 'toolu_ok');
    expect(errResult).toBeDefined();
    expect(errResult?.toolCallId).toBe('toolu_err');
    expect(okResults.every((r) => r.isError === false)).toBe(true);
  });

  it('builds an Edit diff displayBlock from structuredPatch when present', () => {
    const jsonl = [
      assistantLine('msg_ED', {
        type: 'tool_use',
        id: 'toolu_edit',
        name: 'Edit',
        input: { file_path: '/x.ts', old_string: 'a', new_string: 'b' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'uuid-edit',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'ok' }],
        },
        toolUseResult: {
          filePath: '/x.ts',
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [' keep', '-old line', '+new line'],
            },
          ],
        },
        timestamp: '2026-05-30T00:00:04.000Z',
      }),
    ].join('\n');

    const result = byKind(renderTranscript(jsonl), 'tool_result')[0]!;
    expect(result.displayBlocks).toEqual([
      { type: 'diff', path: '/x.ts', oldText: 'keep\nold line', newText: 'keep\nnew line' },
    ]);
  });

  it('nests a subagent under its parent Task tool_call via meta.toolUseId', () => {
    const main = [
      assistantLine('msg_M', { type: 'text', text: 'spawning a subagent' }),
      assistantLine('msg_M', {
        type: 'tool_use',
        id: 'toolu_task',
        name: 'Task',
        input: { description: 'do work', subagent_type: 'general-purpose' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'uuid-task-res',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'done' }],
        },
        toolUseResult: { agentId: 'aXYZ', status: 'completed' },
        timestamp: '2026-05-30T00:00:05.000Z',
      }),
    ].join('\n');

    const agentJsonl = [
      JSON.stringify({
        type: 'user',
        uuid: 'sa-u1',
        isSidechain: true,
        parentUuid: null,
        message: { role: 'user', content: 'subagent prompt' },
        timestamp: '2026-05-30T00:00:05.500Z',
      }),
      assistantLine('msg_SA', { type: 'text', text: 'subagent reply' }, { isSidechain: true }),
    ].join('\n');

    const subagents = {
      'agent-aXYZ.jsonl': agentJsonl,
      'agent-aXYZ.meta.json': JSON.stringify({
        agentType: 'general-purpose',
        description: 'do work',
        toolUseId: 'toolu_task',
      }),
    };

    const blocks = renderTranscript(main, subagents);

    const subagentBlocks = byKind(blocks, 'subagent');
    expect(subagentBlocks).toHaveLength(1);
    const sa = subagentBlocks[0]!;
    expect(sa.id).toBe('subagent:toolu_task');
    expect(sa.parentToolCallId).toBe('toolu_task');
    expect(sa.subagentType).toBe('general-purpose');
    expect(sa.description).toBe('do work');
    expect(sa.isStreaming).toBe(false);

    // Inner blocks were rendered recursively.
    const innerText = byKind(sa.blocks, 'text');
    expect(innerText.map((b) => b.content)).toContain('subagent reply');
    const innerUser = byKind(sa.blocks, 'user');
    expect(innerUser.map((b) => b.content)).toContain('subagent prompt');

    // The subagent block is inserted immediately AFTER its parent tool_call.
    const taskIdx = blocks.findIndex((b) => b.kind === 'tool_call' && b.id === 'toolu_task');
    const saIdx = blocks.findIndex((b) => b.kind === 'subagent');
    expect(saIdx).toBe(taskIdx + 1);
  });

  it('appends a subagent at the end when meta lacks a matching toolUseId', () => {
    const main = assistantLine('msg_N', { type: 'text', text: 'no task here' });
    const subagents = {
      'agent-orphan.jsonl': assistantLine('msg_O', { type: 'text', text: 'orphan output' }),
      'agent-orphan.meta.json': JSON.stringify({ agentType: 'general-purpose' }),
    };

    const blocks = renderTranscript(main, subagents);
    const subagentBlocks = byKind(blocks, 'subagent');
    expect(subagentBlocks).toHaveLength(1);
    expect(subagentBlocks[0]!.id).toBe('subagent:agent-orphan.jsonl');
    expect(subagentBlocks[0]!.parentToolCallId).toBe('');
    // Appended last.
    expect(blocks[blocks.length - 1]!.kind).toBe('subagent');
  });

  it('skips malformed and bookkeeping lines tolerantly', () => {
    const jsonl = [
      '', // blank
      'not json at all {',
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'file-history-snapshot', foo: 1 }),
      JSON.stringify({ type: 'summary', summary: 'x' }),
      assistantLine('msg_Z', { type: 'text', text: 'survived' }),
      '   ', // whitespace only
    ].join('\n');

    const blocks = renderTranscript(jsonl);
    const text = byKind(blocks, 'text');
    expect(text).toHaveLength(1);
    expect(text[0]!.content).toBe('survived');
    expect(text[0]!.id).toBe('msg_Z:0');
  });

  it('handles empty / null input without throwing', () => {
    expect(renderTranscript('')).toEqual([]);
    expect(renderTranscript('', null)).toEqual([]);
    expect(renderTranscript('\n\n  \n')).toEqual([]);
  });
});
