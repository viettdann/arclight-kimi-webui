import { describe, expect, it } from 'bun:test';
import { wireEventsToBlocks } from '../../src/services/wire-events';
import type { StreamEvent } from '@moonshot-ai/kimi-agent-sdk';
import type { Block } from 'shared/types';

type WireEvent = StreamEvent;
type BlockOfKind<K extends Block['kind']> = Extract<Block, { kind: K }>;
function assertKind<K extends Block['kind']>(b: Block | undefined, kind: K): BlockOfKind<K> {
  if (!b || b.kind !== kind) throw new Error(`expected ${kind}, got ${b?.kind ?? 'undefined'}`);
  return b as BlockOfKind<K>;
}

describe('wireEventsToBlocks folding', () => {
  it('correctly folds standard user input and text/thinking streams', () => {
    const timestamp = new Date().toISOString();
    const events: (WireEvent & { timestamp: string })[] = [
      {
        type: 'TurnBegin',
        payload: { id: 'turn-1', user_slug: 'alice' },
        timestamp,
      },
      {
        type: 'StepBegin',
        payload: { id: 'step-1' },
        timestamp,
      },
      {
        type: 'ContentPart',
        payload: { type: 'think', think: 'Hmm, let ' },
        timestamp,
      },
      {
        type: 'ContentPart',
        payload: { type: 'think', think: 'me think.' },
        timestamp,
      },
      {
        type: 'StepInterrupted',
        payload: {},
        timestamp,
      },
      {
        type: 'StepBegin',
        payload: { id: 'step-2' },
        timestamp,
      },
      {
        type: 'ContentPart',
        payload: { type: 'text', text: 'Hello ' },
        timestamp,
      },
      {
        type: 'ContentPart',
        payload: { type: 'text', text: 'world!' },
        timestamp,
      },
      {
        type: 'TurnEnd',
        payload: { status: 'finished', total_tokens: 100 },
        timestamp,
      },
    ];

    const blocks = wireEventsToBlocks(events);
    // Should have user block, thinking block, and text block -> 3 blocks
    expect(blocks.length).toBe(3);

    const userBlock = assertKind(blocks[0], 'user');
    expect(userBlock.kind).toBe('user');

    const thinkingBlock = assertKind(blocks[1], 'thinking');
    expect(thinkingBlock.content).toBe('Hmm, let me think.');

    const textBlock = assertKind(blocks[2], 'text');
    expect(textBlock.content).toBe('Hello world!');
  });

  it('correctly folds steering input blocks with deterministic steer indices', () => {
    const timestamp = new Date().toISOString();
    const events: (WireEvent & { timestamp: string })[] = [
      {
        type: 'TurnBegin',
        payload: { id: 'turn-1', user_slug: 'alice' },
        timestamp,
      },
      {
        type: 'SteerInput',
        payload: {
          user_input: [{ type: 'text', text: 'Go faster!' }],
        },
        timestamp,
      },
      {
        type: 'SteerInput',
        payload: {
          user_input: [{ type: 'text', text: 'Wait, stop!' }],
        },
        timestamp,
      },
    ];

    const blocks = wireEventsToBlocks(events);
    const steerBlocks = blocks.filter((b): b is BlockOfKind<'steer'> => b.kind === 'steer');
    expect(steerBlocks.length).toBe(2);
    expect(steerBlocks[0]?.id).toBe('steer:0');
    expect(steerBlocks[0]?.content).toBe('Go faster!');
    expect(steerBlocks[1]?.id).toBe('steer:1');
    expect(steerBlocks[1]?.content).toBe('Wait, stop!');
  });

  it('handles recursive subagent events and nesting accordions', () => {
    const timestamp = new Date().toISOString();
    const events: (WireEvent & { timestamp: string })[] = [
      {
        type: 'TurnBegin',
        payload: { id: 'turn-1', user_slug: 'alice' },
        timestamp,
      },
      {
        type: 'StepBegin',
        payload: { id: 'step-1' },
        timestamp,
      },
      {
        type: 'ToolCall',
        payload: {
          id: 'tc-subagent',
          function: { name: 'delegate_agent', arguments: '{}' },
        },
        timestamp,
      },
      {
        type: 'SubagentEvent',
        payload: {
          parent_tool_call_id: 'tc-subagent',
          event: {
            type: 'TurnBegin',
            payload: {
              id: 'nested-turn-1',
              user_slug: 'alice',
              user_input: [{ type: 'text', text: 'hi' }],
            },
          },
        },
        timestamp,
      },
      {
        type: 'SubagentEvent',
        payload: {
          parent_tool_call_id: 'tc-subagent',
          event: {
            type: 'StepBegin',
            payload: { id: 'nested-step-1' },
          },
        },
        timestamp,
      },
      {
        type: 'SubagentEvent',
        payload: {
          parent_tool_call_id: 'tc-subagent',
          event: {
            type: 'ContentPart',
            payload: { type: 'text', text: 'Inside subagent' },
          },
        },
        timestamp,
      },
      {
        type: 'ToolResult',
        payload: {
          tool_call_id: 'tc-subagent',
          return_value: { output: 'Subagent finished', is_error: false },
        },
        timestamp,
      },
    ];

    const blocks = wireEventsToBlocks(events);
    const subagentBlock = blocks.find((b): b is BlockOfKind<'subagent'> => b.kind === 'subagent');
    expect(subagentBlock).toBeDefined();
    expect(subagentBlock?.parentToolCallId).toBe('tc-subagent');
    expect(subagentBlock?.blocks.length).toBe(2); // user and text blocks inside nested subagent
    const innerText = assertKind(subagentBlock?.blocks[1], 'text');
    expect(innerText.content).toBe('Inside subagent');
  });

  it('generates synthetic interrupted tool results for orphan tool calls', () => {
    const timestamp = new Date().toISOString();
    const events: (WireEvent & { timestamp: string })[] = [
      {
        type: 'TurnBegin',
        payload: { id: 'turn-1', user_slug: 'alice' },
        timestamp,
      },
      {
        type: 'StepBegin',
        payload: { id: 'step-1' },
        timestamp,
      },
      {
        type: 'ToolCall',
        payload: {
          id: 'tc-orphan-1',
          function: { name: 'run_cmd', arguments: '{"cmd":"sleep 10"}' },
        },
        timestamp,
      },
      {
        type: 'StepInterrupted',
        payload: {},
        timestamp,
      },
    ];

    const blocks = wireEventsToBlocks(events);
    const toolResultBlock = blocks.find(
      (b): b is BlockOfKind<'tool_result'> =>
        b.kind === 'tool_result' && b.toolCallId === 'tc-orphan-1',
    );
    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock?.synthetic).toBe('interrupted');
    expect(toolResultBlock?.isError).toBe(true);
  });
});
