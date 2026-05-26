import { describe, expect, it } from 'bun:test';
import { updateLiveOverlay } from '../../src/services/kimi-session';
import { KimiSessionManager } from '../../src/services/session-manager';
import { stubSession } from '../_helpers';
import type { StreamEvent } from '@moonshot-ai/kimi-agent-sdk';

describe('updateLiveOverlay', () => {
  it('handles TurnBegin and resets properties', () => {
    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    active.liveTextDelta = 'old';
    active.liveThinkingDelta = 'old think';

    const ev: StreamEvent = {
      type: 'TurnBegin',
      payload: { id: 'turn-0', user_slug: 'alice' },
    };

    updateLiveOverlay(active, ev);

    expect(active.liveTurnIdx).toBe(0);
    expect(active.liveStepIdx).toBe(0);
    expect(active.liveTextDelta).toBe('');
    expect(active.liveThinkingDelta).toBe('');
  });

  it('handles ContentPart and appends deltas', () => {
    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    updateLiveOverlay(active, {
      type: 'ContentPart',
      payload: { type: 'text', text: 'Hello' },
    } as any);

    updateLiveOverlay(active, {
      type: 'ContentPart',
      payload: { type: 'text', text: ' World' },
    } as any);

    updateLiveOverlay(active, {
      type: 'ContentPart',
      payload: { type: 'think', think: 'Thinking delta' },
    } as any);

    expect(active.liveTextDelta).toBe('Hello World');
    expect(active.liveThinkingDelta).toBe('Thinking delta');
  });

  it('handles ToolCallPart and accumulates partial arguments', () => {
    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    active.translator.lastToolCallId = 'tc-1';
    updateLiveOverlay(active, {
      type: 'ToolCallPart',
      payload: { arguments_part: '{"arg"' },
    } as any);

    updateLiveOverlay(active, {
      type: 'ToolCallPart',
      payload: { arguments_part: ':"val"}' },
    } as any);

    expect(active.partialToolCallArgs.get('tc-1')).toBe('{"arg":"val"}');
  });

  it('drops partialToolCallArgs entry on ToolResult so resume snapshot does not re-stream finished tools', () => {
    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    active.partialToolCallArgs.set('tc-9vw', '{"path":"/a/b"');
    active.partialToolCallArgs.set('tc-other', '{"x":1');

    updateLiveOverlay(active, {
      type: 'ToolResult',
      payload: {
        tool_call_id: 'tc-9vw',
        return_value: { is_error: false, output: 'ok', message: null, display: [] },
      },
    } as any);

    expect(active.partialToolCallArgs.has('tc-9vw')).toBe(false);
    expect(active.partialToolCallArgs.get('tc-other')).toBe('{"x":1');
  });

  it('clears live deltas on TurnEnd but preserves liveTurnIdx', () => {
    // liveTurnIdx is intentionally PRESERVED across TurnEnd so that the next
    // TurnBegin increments to the right slot. Resetting to null caused the
    // cross-turn block-id collision bug (next turn would land back on
    // turnIdx=0 and stream into the previous turn's thinking/text block).
    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    active.liveTextDelta = 'some text';
    active.liveThinkingDelta = 'some think';
    active.liveTurnIdx = 5;
    active.liveStepIdx = 2;

    updateLiveOverlay(active, {
      type: 'TurnEnd',
      payload: { status: 'finished' },
    } as any);

    expect(active.liveTextDelta).toBe('');
    expect(active.liveThinkingDelta).toBe('');
    // Preserved so the next TurnBegin increments from 5 → 6.
    expect(active.liveTurnIdx).toBe(5);
    expect(active.liveStepIdx).toBe(2);
  });
});
