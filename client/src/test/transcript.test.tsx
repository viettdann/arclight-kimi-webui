import { cleanup, render, screen } from '@testing-library/react';
import type { Block } from 'shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSessionState } from '@/lib/chat-store';

// --- hoisted mutable state for react-router mock ---
const holder = vi.hoisted(() => ({ id: undefined as string | undefined }));
const { sendWS } = vi.hoisted(() => ({ sendWS: vi.fn() }));

// --- hoisted mock for ws-client singleton ---
const { isOpen, on } = vi.hoisted(() => ({
  isOpen: vi.fn(() => true),
  on: vi.fn(() => () => {}),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ id: holder.id }),
}));

vi.mock('@/lib/ws-send', () => ({ sendWS }));

vi.mock('@/lib/ws-client', () => ({
  wsClient: { isOpen, on },
}));

// Mock all block-rendering components to avoid deep rendering.
// Each renders a stable test-id so we can assert presence.
vi.mock('@/components/blocks/block-registry', () => ({
  BlockRegistry: ({ block }: { block: Block }) => (
    <div data-testid={`block-${block.kind}`} data-block-id={block.id} />
  ),
}));

vi.mock('@/components/blocks/subagent-bundle', () => ({
  SubagentBundle: ({
    toolCall,
  }: {
    toolCall: Extract<Block, { kind: 'tool_call' }>;
    subagent: unknown;
    toolResult: unknown;
  }) => <div data-testid="subagent-bundle" data-tool-call-id={toolCall.toolCallId} />,
}));

vi.mock('@/components/blocks/timeline/activity-timeline', () => ({
  ActivityTimeline: ({ items }: { items: unknown[] }) => (
    <div data-testid="activity-timeline" data-count={items.length} />
  ),
  isRailEligible: () => false,
}));

import { Transcript } from '@/components/transcript';
import { useChatStore } from '@/lib/chat-store';

// --- helpers ---

const defaultSession = (over: Partial<ChatSessionState> = {}): ChatSessionState => ({
  blocks: [],
  totalTokens: null,
  contextUsage: null,
  contextEpoch: 0,
  totalCostUsd: null,
  title: null,
  pendingPrompt: null,
  isTurnInProgress: false,
  thinking: false,
  approvalMode: 'ask',
  effort: null,
  ultracode: false,
  rateLimit: null,
  apiRetry: null,
  ...over,
});

beforeEach(() => {
  holder.id = undefined;
  sendWS.mockReset();
  isOpen.mockReturnValue(true);
  on.mockReturnValue(() => {});
  useChatStore.setState({ sessions: {} });
});

afterEach(cleanup);

describe('Transcript — no session', () => {
  it('shows "No active session" when sessionId is absent', () => {
    holder.id = undefined;
    render(<Transcript />);
    expect(screen.getByText('No active session')).toBeInTheDocument();
  });
});

describe('Transcript — loading / empty session', () => {
  it('shows loading state when sessionId exists but session data is absent', () => {
    holder.id = 'sess-1';
    render(<Transcript />);
    expect(screen.getByText('Loading session data...')).toBeInTheDocument();
  });

  it('shows "Session ready" when session exists with no blocks', () => {
    holder.id = 'sess-1';
    useChatStore.setState({ sessions: { 'sess-1': defaultSession() } });
    render(<Transcript />);
    expect(screen.getByText('Session ready')).toBeInTheDocument();
  });
});

describe('Transcript — renders blocks', () => {
  it('renders user and text blocks via BlockRegistry', () => {
    holder.id = 'sess-1';
    const blocks: Block[] = [
      { kind: 'user', id: 'b1', content: 'Hello', createdAt: '2026-01-01T00:00:00Z' },
      {
        kind: 'text',
        id: 'b2',
        content: 'Hi there',
        isStreaming: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    useChatStore.setState({
      sessions: { 'sess-1': defaultSession({ blocks }) },
    });

    render(<Transcript />);

    expect(screen.getByTestId('block-user')).toBeInTheDocument();
    expect(screen.getByTestId('block-text')).toBeInTheDocument();
    expect(screen.queryByText('Session ready')).not.toBeInTheDocument();
  });

  it('renders subagent bundles when tool_call has a matching subagent', () => {
    holder.id = 'sess-1';
    const blocks: Block[] = [
      {
        kind: 'tool_call',
        id: 'tc1',
        toolCallId: 'tc-1',
        name: 'Task',
        args: {},
        isStreaming: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        kind: 'subagent',
        id: 'sa1',
        parentToolCallId: 'tc-1',
        blocks: [],
        isStreaming: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    useChatStore.setState({
      sessions: { 'sess-1': defaultSession({ blocks }) },
    });

    render(<Transcript />);

    // The subagent is bundled with its parent tool_call.
    expect(screen.getByTestId('subagent-bundle')).toHaveAttribute('data-tool-call-id', 'tc-1');
    // No standalone block-user/block-text — the bundle consumed both.
    expect(screen.queryByTestId('block-tool_call')).not.toBeInTheDocument();
  });
});

describe('Transcript — resume_session hydration', () => {
  it('sends resume_session when landing on a session with no snapshot and ws is open', () => {
    holder.id = 'sess-fresh';
    // No session in store → no snapshot.
    isOpen.mockReturnValue(true);

    render(<Transcript />);

    expect(sendWS).toHaveBeenCalledWith('resume_session', { sessionId: 'sess-fresh' });
  });

  it('does not send resume_session when a snapshot already exists', () => {
    holder.id = 'sess-cached';
    useChatStore.setState({
      sessions: { 'sess-cached': defaultSession() },
    });
    isOpen.mockReturnValue(true);

    render(<Transcript />);

    expect(sendWS).not.toHaveBeenCalled();
  });

  it('defers resume_session until ws opens if socket is not ready', () => {
    holder.id = 'sess-deferred';
    let openCallback: (() => void) | undefined;
    isOpen.mockReturnValue(false);
    // wsClient.on('open', cb) — capture the callback.
    (on as ReturnType<typeof vi.fn>).mockImplementation((_event: unknown, cb: () => void) => {
      openCallback = cb;
      return () => {};
    });

    render(<Transcript />);
    expect(sendWS).not.toHaveBeenCalled();

    // Simulate the socket opening later.
    openCallback!();
    expect(sendWS).toHaveBeenCalledWith('resume_session', { sessionId: 'sess-deferred' });
  });
});
