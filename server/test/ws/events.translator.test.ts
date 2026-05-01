import { describe, expect, it } from 'bun:test';
import type { StreamEvent } from '@moonshot-ai/kimi-agent-sdk';
import { createTranslatorState, translateStreamEvent } from '../../src/ws/events';

describe('translateStreamEvent — new cases', () => {
  it('QuestionRequest normalizes snake_case multi_select → multiSelect, round-trips header & description', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = {
      type: 'QuestionRequest',
      payload: {
        id: 'q-1',
        tool_call_id: 'tc-1',
        questions: [
          {
            question: 'Pick one',
            header: 'Header text',
            options: [{ label: 'A', description: 'first' }, { label: 'B' }],
            multi_select: true,
          },
        ],
      },
    } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({
      type: 'question_request',
      payload: {
        id: 'tc-1',
        requestId: 'q-1',
        questions: [
          {
            question: 'Pick one',
            header: 'Header text',
            options: [{ label: 'A', description: 'first' }, { label: 'B' }],
            multiSelect: true,
          },
        ],
      },
    });
  });

  it('QuestionRequest omits multiSelect and header when not provided (not undefined)', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = {
      type: 'QuestionRequest',
      payload: {
        id: 'q-2',
        tool_call_id: 'tc-2',
        questions: [
          {
            question: 'No header here',
            options: [{ label: 'X' }],
          },
        ],
      },
    } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({
      type: 'question_request',
      payload: {
        id: 'tc-2',
        requestId: 'q-2',
        questions: [
          {
            question: 'No header here',
            options: [{ label: 'X' }],
          },
        ],
      },
    });
    const q = (out!.payload as { questions: Record<string, unknown>[] }).questions[0];
    expect(q).not.toHaveProperty('multiSelect');
    expect(q).not.toHaveProperty('header');
    const opt = (q!.options as Record<string, unknown>[])[0];
    expect(opt).not.toHaveProperty('description');
  });

  it('StepInterrupted → step_interrupted with empty payload', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = { type: 'StepInterrupted', payload: {} } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({ type: 'step_interrupted', payload: {} });
  });

  it('CompactionBegin → compaction_begin with empty payload', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = { type: 'CompactionBegin', payload: {} } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({ type: 'compaction_begin', payload: {} });
  });

  it('CompactionEnd → compaction_end with empty payload', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = { type: 'CompactionEnd', payload: {} } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({ type: 'compaction_end', payload: {} });
  });

  it('SteerInput with string user_input → steer_input { content: <string> }', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = {
      type: 'SteerInput',
      payload: { user_input: 'hello world' },
    } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({
      type: 'steer_input',
      payload: { content: 'hello world' },
    });
  });

  it('SteerInput with array user_input concatenates text parts and drops non-text', () => {
    const state = createTranslatorState();
    const ev: StreamEvent = {
      type: 'SteerInput',
      payload: {
        user_input: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
          { type: 'image_url', image_url: { url: 'http://example.com/x.png' } },
        ],
      },
    } as StreamEvent;
    const out = translateStreamEvent(ev, state);
    expect(out).toEqual({
      type: 'steer_input',
      payload: { content: 'ab' },
    });
  });

  it('ParseError wire event → parse_error; rawType is omitted when missing', () => {
    const state = createTranslatorState();

    // Case A: rawType present
    const evA: StreamEvent = {
      type: 'ParseError',
      payload: { code: 'bad_event', message: 'oops', rawType: 'WeirdEvent' },
    } as StreamEvent;
    const outA = translateStreamEvent(evA, state);
    expect(outA).toEqual({
      type: 'parse_error',
      payload: { code: 'bad_event', message: 'oops', rawType: 'WeirdEvent' },
    });

    // Case B: rawType missing
    const evB: StreamEvent = {
      type: 'ParseError',
      payload: { code: 'bad_event', message: 'oops' },
    } as StreamEvent;
    const outB = translateStreamEvent(evB, state);
    expect(outB).toEqual({
      type: 'parse_error',
      payload: { code: 'bad_event', message: 'oops' },
    });
    expect(outB!.payload).not.toHaveProperty('rawType');
  });

  it('Top-level error StreamEvent → parse_error; raw is omitted when missing', () => {
    const state = createTranslatorState();

    // Case A: raw present
    const evA: StreamEvent = {
      type: 'error',
      code: 'parse_failed',
      message: 'bad json',
      raw: '{"broken":',
    } as StreamEvent;
    const outA = translateStreamEvent(evA, state);
    expect(outA).toEqual({
      type: 'parse_error',
      payload: { code: 'parse_failed', message: 'bad json', raw: '{"broken":' },
    });

    // Case B: raw missing
    const evB: StreamEvent = {
      type: 'error',
      code: 'parse_failed',
      message: 'bad json',
    } as StreamEvent;
    const outB = translateStreamEvent(evB, state);
    expect(outB).toEqual({
      type: 'parse_error',
      payload: { code: 'parse_failed', message: 'bad json' },
    });
    expect(outB!.payload).not.toHaveProperty('raw');
  });

  it('Unknown / unmapped event types return null', () => {
    const state = createTranslatorState();
    const evTurnEnd: StreamEvent = { type: 'TurnEnd', payload: {} } as StreamEvent;
    const evHook: StreamEvent = { type: 'HookTriggered', payload: {} } as StreamEvent;
    expect(translateStreamEvent(evTurnEnd, state)).toBeNull();
    expect(translateStreamEvent(evHook, state)).toBeNull();
  });
});
