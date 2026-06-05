import { renderHook } from '@testing-library/react';
import type { Block, DisplayBlock } from 'shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, useLatestTodos } from '@/lib/chat-store';

describe('useChatStore', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    // Reset Zustand store state before each test
    useChatStore.setState({ sessions: {} });
    vi.restoreAllMocks();
  });

  it('should initialize and return default session state', () => {
    const session = useChatStore.getState().getOrCreateSession(sessionId);
    expect(session).toBeDefined();
    expect(session.blocks).toEqual([]);
    expect(session.totalTokens).toBeNull();
    expect(session.contextUsage).toBeNull();
    expect(session.isTurnInProgress).toBe(false);
  });

  it('should add pending user block (optimistic update)', () => {
    useChatStore.getState().addPendingUserBlock(sessionId, 'Hello Kimi');

    const session = useChatStore.getState().sessions[sessionId];
    expect(session).toBeDefined();
    expect(session!.pendingPrompt).toEqual({
      text: 'Hello Kimi',
      enqueuedAt: expect.any(String),
    });
    expect(session!.blocks).toHaveLength(1);
    expect(session!.blocks[0]).toEqual({
      kind: 'user',
      id: `user:pending:${sessionId}`,
      content: 'Hello Kimi',
      status: 'pending',
      createdAt: expect.any(String),
    });
  });

  it('should load session snapshot from server', () => {
    const mockBlocks: Block[] = [
      {
        kind: 'user',
        id: 'u-1',
        content: 'hello',
        createdAt: '2026-06-01T00:00:00Z',
        status: 'sent',
      },
    ];
    const snapshotPayload = {
      blocks: mockBlocks,
      totalTokens: 120,
      contextUsage: null,
      totalCostUsd: 0.05,
      title: 'First chat',
      pendingPrompt: null,
      live: { turnInProgress: true },
      thinking: false,
      approvalMode: 'ask' as const,
      effort: 'medium' as const,
      commands: [],
    };

    useChatStore.getState().loadSnapshot(sessionId, snapshotPayload);

    const session = useChatStore.getState().sessions[sessionId];
    expect(session).toBeDefined();
    expect(session!.blocks).toEqual(mockBlocks);
    expect(session!.totalTokens).toBe(120);
    expect(session!.totalCostUsd).toBe(0.05);
    expect(session!.title).toBe('First chat');
    expect(session!.isTurnInProgress).toBe(true);
    expect(session!.thinking).toBe(false);
    expect(session!.approvalMode).toBe('ask');
    expect(session!.effort).toBe('medium');
  });

  describe('applyEvent', () => {
    it('should handle turn_begin and drop optimistic pending user block', () => {
      // 1. Add optimistic pending block
      useChatStore.getState().addPendingUserBlock(sessionId, 'Hello Kimi');

      // 2. Server responds with turn_begin
      useChatStore.getState().applyEvent(sessionId, 'turn_begin', {
        id: 'user-confirmed-id',
        userInput: 'Hello Kimi',
      });

      const session = useChatStore.getState().sessions[sessionId];
      expect(session!.isTurnInProgress).toBe(true);
      expect(session!.pendingPrompt).toBeNull();
      expect(session!.blocks).toHaveLength(1);
      expect(session!.blocks[0]).toEqual({
        kind: 'user',
        id: 'user-confirmed-id',
        content: 'Hello Kimi',
        status: 'sent',
        createdAt: expect.any(String),
      });
    });

    it('should handle text_delta stream', () => {
      // 1. Receive first text chunk
      useChatStore.getState().applyEvent(sessionId, 'text_delta', {
        id: 'text-1',
        text: 'Hello ',
        final: false,
      });

      let session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks).toHaveLength(1);
      expect(session!.blocks[0]).toEqual({
        kind: 'text',
        id: 'text-1',
        content: 'Hello ',
        isStreaming: true,
        createdAt: expect.any(String),
      });

      // 2. Receive second chunk
      useChatStore.getState().applyEvent(sessionId, 'text_delta', {
        id: 'text-1',
        text: 'world!',
        final: false,
      });

      session = useChatStore.getState().sessions[sessionId];
      expect((session!.blocks[0] as any).content).toBe('Hello world!');
      expect((session!.blocks[0] as any).isStreaming).toBe(true);

      // 3. Finalize text stream
      useChatStore.getState().applyEvent(sessionId, 'text_delta', {
        id: 'text-1',
        text: 'Hello world!',
        final: true,
      });

      session = useChatStore.getState().sessions[sessionId];
      expect((session!.blocks[0] as any).content).toBe('Hello world!');
      expect((session!.blocks[0] as any).isStreaming).toBe(false);
    });

    it('should handle thinking_delta stream', () => {
      // 1. Receive thinking chunk
      useChatStore.getState().applyEvent(sessionId, 'thinking_delta', {
        id: 'think-1',
        thinking: 'Let me think...',
        encrypted: false,
        final: false,
      });

      let session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks[0]).toEqual({
        kind: 'thinking',
        id: 'think-1',
        content: 'Let me think...',
        encrypted: false,
        isStreaming: true,
        createdAt: expect.any(String),
      });

      // 2. Finalize thinking stream
      useChatStore.getState().applyEvent(sessionId, 'thinking_delta', {
        id: 'think-1',
        thinking: 'Let me think... Done.',
        encrypted: true,
        final: true,
      });

      session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks[0]).toEqual({
        kind: 'thinking',
        id: 'think-1',
        content: 'Let me think... Done.',
        encrypted: true,
        isStreaming: false,
        createdAt: expect.any(String),
      });
    });

    it('should handle tool_call and tool_call_delta', () => {
      // 1. Initiate tool_call
      useChatStore.getState().applyEvent(sessionId, 'tool_call', {
        id: 'call-1',
        name: 'run_command',
        arguments: '',
      });

      let session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks[0]).toEqual({
        kind: 'tool_call',
        id: 'call-1',
        toolCallId: 'call-1',
        name: 'run_command',
        args: '',
        isStreaming: false,
        createdAt: expect.any(String),
      });

      // 2. Stream arguments
      useChatStore.getState().applyEvent(sessionId, 'tool_call_delta', {
        id: 'call-1',
        argumentsPart: '{"cmd": "ls"}',
      });

      session = useChatStore.getState().sessions[sessionId];
      expect((session!.blocks[0] as any).argsStreaming).toBe('{"cmd": "ls"}');
    });

    it('should handle tool_result and find parent tool call name', () => {
      // 1. Create tool call
      useChatStore.getState().applyEvent(sessionId, 'tool_call', {
        id: 'call-1',
        name: 'list_files',
        arguments: '{"path": "."}',
      });

      // 2. Apply tool result
      useChatStore.getState().applyEvent(sessionId, 'tool_result', {
        toolCallId: 'call-1',
        output: '["file1.txt"]',
        message: 'Success',
        isError: false,
        displayBlocks: [],
      });

      const session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks).toHaveLength(2);
      expect((session!.blocks[0] as any).isStreaming).toBe(false);
      expect(session!.blocks[1]).toEqual({
        kind: 'tool_result',
        id: 'call-1',
        toolCallId: 'call-1',
        toolName: 'list_files', // Looked up successfully from blocks
        output: '["file1.txt"]',
        message: 'Success',
        displayBlocks: [],
        isError: false,
        createdAt: expect.any(String),
      });
    });

    it('should handle approval_request and approval_response', () => {
      useChatStore.getState().applyEvent(sessionId, 'approval_request', {
        requestId: 'req-1',
        id: 'call-1',
        action: 'write_file',
        description: 'Writing index.js',
      });

      let session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks[0]).toEqual({
        kind: 'approval_request',
        id: 'approval:req-1',
        requestId: 'req-1',
        toolCallId: 'call-1',
        action: 'write_file',
        description: 'Writing index.js',
        createdAt: expect.any(String),
      });

      // Resolve approval
      useChatStore.getState().applyEvent(sessionId, 'approval_response', {
        requestId: 'req-1',
        response: 'approve',
      });

      session = useChatStore.getState().sessions[sessionId];
      expect((session!.blocks[0] as any).resolution).toBe('approve');
    });

    it('should handle question_request', () => {
      const mockQuestions = [
        { question: 'Are you sure?', options: ['Yes', 'No'], isMultiSelect: false },
      ];
      useChatStore.getState().applyEvent(sessionId, 'question_request', {
        requestId: 'q-1',
        id: 'call-1',
        questions: mockQuestions,
      });

      const session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks[0]).toEqual({
        kind: 'question_request',
        id: 'question:q-1',
        requestId: 'q-1',
        toolCallId: 'call-1',
        questions: mockQuestions,
        createdAt: expect.any(String),
      });
    });

    it('answer_question local echo marks the question resolved and records answers', () => {
      useChatStore.getState().applyEvent(sessionId, 'question_request', {
        requestId: 'q-1',
        id: 'call-1',
        questions: [{ question: 'Are you sure?', options: [] }],
      });
      useChatStore.getState().applyEvent(sessionId, 'answer_question', {
        requestId: 'q-1',
        answers: { 'Are you sure?': 'Yes' },
      });

      const block = useChatStore.getState().sessions[sessionId]!.blocks[0] as any;
      expect(block.resolved).toBe(true);
      expect(block.answers).toEqual({ 'Are you sure?': 'Yes' });
    });

    it('tool_result resolves the question_request sharing its toolCallId', () => {
      useChatStore.getState().applyEvent(sessionId, 'question_request', {
        requestId: 'q-1',
        id: 'call-1',
        questions: [{ question: 'Are you sure?', options: [] }],
      });
      useChatStore.getState().applyEvent(sessionId, 'tool_result', {
        toolCallId: 'call-1',
        output: 'Your questions have been answered',
        isError: false,
      });

      const block = useChatStore.getState().sessions[sessionId]!.blocks[0] as any;
      expect(block.kind).toBe('question_request');
      expect(block.resolved).toBe(true);
    });

    it('should recursively handle subagent_events', () => {
      // 1. Create a parent tool call that spawns subagent
      useChatStore.getState().applyEvent(sessionId, 'tool_call', {
        id: 'call-parent',
        name: 'invoke_subagent',
        arguments: '{}',
      });

      // 2. Receive subagent starting event
      useChatStore.getState().applyEvent(sessionId, 'subagent_event', {
        parentToolCallId: 'call-parent',
        subagentType: 'coder',
        description: 'Writing test suite',
        inner: null, // Just a header-only start frame
      });

      let session = useChatStore.getState().sessions[sessionId];
      expect(session!.blocks).toHaveLength(2);
      expect(session!.blocks[1]).toEqual({
        kind: 'subagent',
        id: 'subagent:call-parent',
        parentToolCallId: 'call-parent',
        subagentType: 'coder',
        description: 'Writing test suite',
        blocks: [],
        isStreaming: true,
        createdAt: expect.any(String),
      });

      // 3. Receive an inner text_delta event inside the subagent
      useChatStore.getState().applyEvent(sessionId, 'subagent_event', {
        parentToolCallId: 'call-parent',
        inner: {
          type: 'text_delta',
          payload: { id: 'inner-text-1', text: 'Subagent response...', final: false },
        },
      });

      session = useChatStore.getState().sessions[sessionId];
      const subagentBlock = session!.blocks[1] as Extract<Block, { kind: 'subagent' }>;
      expect(subagentBlock.blocks).toHaveLength(1);
      expect(subagentBlock.blocks[0]).toEqual({
        kind: 'text',
        id: 'inner-text-1',
        content: 'Subagent response...',
        isStreaming: true,
        createdAt: expect.any(String),
      });
      expect(subagentBlock.isStreaming).toBe(true);

      // 4. End subagent's turn
      useChatStore.getState().applyEvent(sessionId, 'subagent_event', {
        parentToolCallId: 'call-parent',
        inner: {
          type: 'turn_end',
          payload: {},
        },
      });

      session = useChatStore.getState().sessions[sessionId];
      const endedSubagent = session!.blocks[1] as Extract<Block, { kind: 'subagent' }>;
      expect((endedSubagent.blocks[0] as any).isStreaming).toBe(false);
      expect(endedSubagent.isStreaming).toBe(false);
    });

    it('should handle turn_end and stop all streaming blocks', () => {
      // Setup: add streaming text block
      useChatStore.getState().applyEvent(sessionId, 'text_delta', {
        id: 'text-1',
        text: 'hello',
        final: false,
      });

      let session = useChatStore.getState().sessions[sessionId];
      expect((session!.blocks[0] as any).isStreaming).toBe(true);

      // Apply turn_end
      useChatStore.getState().applyEvent(sessionId, 'turn_end', {});

      session = useChatStore.getState().sessions[sessionId];
      expect((session!.blocks[0] as any).isStreaming).toBe(false);
      expect(session!.isTurnInProgress).toBe(false);
      expect(session!.contextEpoch).toBe(1);
    });

    it('should append a cancelled marker on a user-interrupted turn_end', () => {
      useChatStore.getState().applyEvent(sessionId, 'text_delta', {
        id: 'text-1',
        text: 'partial',
        final: false,
      });

      useChatStore.getState().applyEvent(sessionId, 'turn_end', { status: 'cancelled' });

      const session = useChatStore.getState().sessions[sessionId];
      // Streaming stopped, no error block, a single cancelled marker appended.
      expect((session!.blocks[0] as any).isStreaming).toBe(false);
      const cancelled = session!.blocks.filter((b) => b.kind === 'cancelled');
      expect(cancelled).toHaveLength(1);
      expect(session!.blocks.some((b) => b.kind === 'error')).toBe(false);
      expect(session!.isTurnInProgress).toBe(false);
    });

    it('should handle error block insertion', () => {
      useChatStore.getState().applyEvent(sessionId, 'error', {
        code: 'rate_limit',
        message: 'Too many requests',
      });

      const session = useChatStore.getState().sessions[sessionId];
      expect(session!.isTurnInProgress).toBe(false);
      expect(session!.blocks).toHaveLength(1);
      expect(session!.blocks[0]).toEqual({
        kind: 'error',
        id: expect.stringContaining('error:'),
        code: 'rate_limit',
        message: 'Too many requests',
        createdAt: expect.any(String),
      });
    });

    it('should handle status_update, context_usage, and title_update', () => {
      // 1. status_update
      useChatStore.getState().applyEvent(sessionId, 'status_update', {
        tokenUsage: 500,
        totalCostUsd: 0.015,
      });
      // 2. context_usage
      useChatStore.getState().applyEvent(sessionId, 'context_usage', {
        input: 100,
        output: 50,
      });
      // 3. title_update
      useChatStore.getState().applyEvent(sessionId, 'title_update', {
        title: 'New Session Title',
      });

      const session = useChatStore.getState().sessions[sessionId];
      expect(session!.totalTokens).toBe(500);
      expect(session!.totalCostUsd).toBe(0.015);
      expect(session!.contextUsage).toEqual({ input: 100, output: 50 });
      expect(session!.title).toBe('New Session Title');
    });
  });

  describe('useLatestTodos', () => {
    it('should return null when session does not exist or has no todos', () => {
      // No session
      const { result: res1 } = renderHook(() => useLatestTodos('non-existent'));
      expect(res1.current).toBeNull();

      // Session exists but no blocks
      useChatStore.getState().getOrCreateSession(sessionId);
      const { result: res2 } = renderHook(() => useLatestTodos(sessionId));
      expect(res2.current).toBeNull();
    });

    it('should extract todo items from the latest tool_result carrying a todo block', () => {
      const mockTodoItems = [{ title: 'Task 1', status: 'pending' as const }];
      const displayBlocks: DisplayBlock[] = [{ type: 'todo', items: mockTodoItems }];

      // 1. Load snapshot with one tool result
      useChatStore.getState().loadSnapshot(sessionId, {
        blocks: [
          {
            kind: 'tool_result',
            id: 'call-1',
            toolCallId: 'call-1',
            toolName: 'cmd',
            output: '',
            message: '',
            isError: false,
            displayBlocks,
            createdAt: '2026-06-01T00:00:00Z',
          },
          {
            // Another unrelated block
            kind: 'text',
            id: 'text-1',
            content: 'hello',
            isStreaming: false,
            createdAt: '2026-06-01T00:01:00Z',
          },
        ],
        totalTokens: 0,
        contextUsage: null,
        totalCostUsd: 0,
        title: null,
        pendingPrompt: null,
        live: { turnInProgress: false },
        thinking: false,
        approvalMode: 'ask',
        effort: null,
        commands: [],
      });

      // Invoke selector hook inside renderHook
      const { result } = renderHook(() => useLatestTodos(sessionId));
      expect(result.current).toEqual(mockTodoItems);
    });

    // Build a minimal tool_result block carrying the given display blocks.
    function toolResultBlock(id: string, displayBlocks: DisplayBlock[]): Block {
      return {
        kind: 'tool_result',
        id,
        toolCallId: id,
        toolName: 'TaskCreate',
        output: '',
        message: '',
        isError: false,
        displayBlocks,
        createdAt: '2026-06-01T00:00:00Z',
      };
    }

    function loadBlocks(blocks: Block[]) {
      useChatStore.getState().loadSnapshot(sessionId, {
        blocks,
        totalTokens: 0,
        contextUsage: null,
        totalCostUsd: 0,
        title: null,
        pendingPrompt: null,
        live: { turnInProgress: false },
        thinking: false,
        approvalMode: 'ask',
        effort: null,
        commands: [],
      });
    }

    it('should fold incremental task create/update events into a checklist', () => {
      loadBlocks([
        toolResultBlock('c1', [{ type: 'task', op: 'create', id: '1', title: 'First' }]),
        toolResultBlock('c2', [{ type: 'task', op: 'create', id: '2', title: 'Second' }]),
        toolResultBlock('u1', [{ type: 'task', op: 'update', id: '1', status: 'in_progress' }]),
        toolResultBlock('u2', [{ type: 'task', op: 'update', id: '1', status: 'done' }]),
        toolResultBlock('u3', [{ type: 'task', op: 'update', id: '2', title: 'Renamed' }]),
      ]);

      const { result } = renderHook(() => useLatestTodos(sessionId));
      expect(result.current).toEqual([
        { title: 'First', status: 'done' },
        { title: 'Renamed', status: 'pending' },
      ]);
    });

    it('should drop deleted tasks and skip updates for unknown ids', () => {
      loadBlocks([
        toolResultBlock('c1', [{ type: 'task', op: 'create', id: '1', title: 'Keep' }]),
        toolResultBlock('c2', [{ type: 'task', op: 'create', id: '2', title: 'Drop' }]),
        toolResultBlock('u1', [{ type: 'task', op: 'update', id: '2', status: 'deleted' }]),
        // Task '99' was never created in this timeline (e.g. subagent-owned).
        toolResultBlock('u2', [{ type: 'task', op: 'update', id: '99', status: 'done' }]),
      ]);

      const { result } = renderHook(() => useLatestTodos(sessionId));
      expect(result.current).toEqual([{ title: 'Keep', status: 'pending' }]);
    });

    it('should reset the checklist when switching from TodoWrite to task events', () => {
      loadBlocks([
        toolResultBlock('t1', [{ type: 'todo', items: [{ title: 'Old todo', status: 'done' }] }]),
        toolResultBlock('c1', [{ type: 'task', op: 'create', id: '1', title: 'New task' }]),
      ]);

      const { result } = renderHook(() => useLatestTodos(sessionId));
      expect(result.current).toEqual([{ title: 'New task', status: 'pending' }]);
    });

    it('should replace the checklist from a task list snapshot', () => {
      loadBlocks([
        toolResultBlock('c1', [{ type: 'task', op: 'create', id: '1', title: 'Stale' }]),
        toolResultBlock('l1', [
          {
            type: 'task',
            op: 'list',
            items: [
              { id: '1', title: 'Fresh', status: 'done' },
              { id: '2', title: 'New', status: 'pending' },
            ],
          },
        ]),
      ]);

      const { result } = renderHook(() => useLatestTodos(sessionId));
      expect(result.current).toEqual([
        { title: 'Fresh', status: 'done' },
        { title: 'New', status: 'pending' },
      ]);
    });
  });

  it('should update session flags and remove session', () => {
    useChatStore.getState().getOrCreateSession(sessionId);
    useChatStore.getState().setSessionFlags(sessionId, {
      thinking: false,
      approvalMode: 'bypass',
      effort: 'high',
    });

    let session = useChatStore.getState().sessions[sessionId];
    expect(session!.thinking).toBe(false);
    expect(session!.approvalMode).toBe('bypass');
    expect(session!.effort).toBe('high');

    // Remove session
    useChatStore.getState().removeSession(sessionId);
    session = useChatStore.getState().sessions[sessionId];
    expect(session).toBeUndefined();
  });
});
