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

  it('clears live state on TurnEnd', () => {
    const manager = new KimiSessionManager();
    const active = manager.register({
      sessionId: 'sess-1',
      userId: 'alice',
      workDir: '/tmp/work',
      kimiSessionId: 'kimi-x',
      kimiSession: stubSession(),
    });

    active.liveTextDelta = 'some text';
    active.liveTurnIdx = 5;

    updateLiveOverlay(active, {
      type: 'TurnEnd',
      payload: { status: 'finished' },
    } as any);

    expect(active.liveTextDelta).toBe('');
    expect(active.liveTurnIdx).toBeNull();
    expect(active.liveStepIdx).toBeNull();
  });
});
