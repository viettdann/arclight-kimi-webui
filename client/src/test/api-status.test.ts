import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/lib/chat-store';

describe('chat-store — rate_limit / api_retry events', () => {
  const sessionId = 'session-api-status';

  beforeEach(() => {
    useChatStore.setState({ sessions: {} });
  });

  it('stores the latest rate_limit payload on the session', () => {
    useChatStore.getState().applyEvent(sessionId, 'rate_limit', {
      status: 'allowed_warning',
      resetsAt: 1764864000,
      rateLimitType: 'five_hour',
      utilization: 87,
    });

    const session = useChatStore.getState().sessions[sessionId];
    expect(session?.rateLimit).toEqual({
      status: 'allowed_warning',
      resetsAt: 1764864000,
      rateLimitType: 'five_hour',
      utilization: 87,
    });
  });

  it('stores api_retry and keeps it across subsequent api_retry/rate_limit frames', () => {
    const store = useChatStore.getState();
    store.applyEvent(sessionId, 'api_retry', {
      attempt: 1,
      maxRetries: 10,
      retryDelayMs: 4000,
      errorStatus: 429,
      errorCode: 'rate_limit',
    });
    store.applyEvent(sessionId, 'rate_limit', { status: 'allowed_warning' });
    store.applyEvent(sessionId, 'api_retry', {
      attempt: 2,
      maxRetries: 10,
      retryDelayMs: 8000,
      errorStatus: 429,
      errorCode: 'rate_limit',
    });

    const session = useChatStore.getState().sessions[sessionId];
    expect(session?.apiRetry?.attempt).toBe(2);
    expect(session?.rateLimit?.status).toBe('allowed_warning');
  });

  it('clears the transient api_retry on the next stream activity', () => {
    const store = useChatStore.getState();
    store.applyEvent(sessionId, 'api_retry', {
      attempt: 3,
      maxRetries: 10,
      retryDelayMs: 8000,
      errorStatus: 429,
      errorCode: 'rate_limit',
    });
    // Retry succeeded — the stream resumes with a text delta.
    store.applyEvent(sessionId, 'text_delta', { id: 'msg_1:0', text: 'hello' });

    const session = useChatStore.getState().sessions[sessionId];
    expect(session?.apiRetry).toBeNull();
    // rateLimit (provider-level) is untouched by stream activity.
  });

  it('clears api_retry when the turn errors out', () => {
    const store = useChatStore.getState();
    store.applyEvent(sessionId, 'api_retry', {
      attempt: 10,
      maxRetries: 10,
      retryDelayMs: 8000,
      errorStatus: 429,
      errorCode: 'rate_limit',
    });
    store.applyEvent(sessionId, 'error', {
      code: 'rate_limit',
      message: 'API Error: Request rejected (429)',
      retryable: true,
    });

    const session = useChatStore.getState().sessions[sessionId];
    expect(session?.apiRetry).toBeNull();
    expect(session?.isTurnInProgress).toBe(false);
    expect(session?.blocks.at(-1)?.kind).toBe('error');
  });

  it('preserves rateLimit across a snapshot reload but drops apiRetry', () => {
    const store = useChatStore.getState();
    store.applyEvent(sessionId, 'rate_limit', { status: 'rejected', resetsAt: 1764864000 });
    store.applyEvent(sessionId, 'api_retry', {
      attempt: 1,
      maxRetries: 10,
      retryDelayMs: 4000,
      errorStatus: 429,
      errorCode: 'rate_limit',
    });

    store.loadSnapshot(sessionId, {
      blocks: [],
      totalTokens: 0,
      totalCostUsd: 0,
      title: null,
      pendingPrompt: null,
      thinking: true,
      approvalMode: 'ask',
      effort: null,
      commands: [],
      live: { turnInProgress: false },
      contextUsage: null,
    });

    const session = useChatStore.getState().sessions[sessionId];
    expect(session?.rateLimit?.status).toBe('rejected');
    expect(session?.apiRetry).toBeNull();
  });
});
