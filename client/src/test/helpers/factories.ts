/**
 * Factory functions for creating typed test data.
 *
 * Each factory accepts partial overrides so tests only specify what matters.
 * Defaults are valid but minimal — real enough to pass type checks and
 * component rendering without being misleading.
 */
import type {
  Block,
  FileEntry,
  ProjectSummary,
  SessionListItem,
  SnapshotPayload,
} from 'shared/types';
import type { AuthUser } from '../../lib/auth-store';

// ─────────────────────────── Auth ───────────────────────────

export function makeAuthUser(overrides?: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    email: 'test@example.test',
    name: 'Test User',
    role: 'admin',
    ...overrides,
  };
}

// ─────────────────────────── Projects ───────────────────────────

export function makeProject(overrides?: Partial<ProjectSummary>): ProjectSummary {
  return {
    name: 'test-project',
    workDir: '/workspace/user/test-project',
    origin: 'local',
    status: 'ready',
    ...overrides,
  };
}

// ─────────────────────────── Sessions ───────────────────────────

export function makeSession(overrides?: Partial<SessionListItem>): SessionListItem {
  return {
    id: 'sess-1',
    workDir: '/workspace/user/test-project',
    projectName: 'test-project',
    localWorkDir: '/workspace/user/test-project',
    origin: 'local',
    title: 'Test Session',
    firstUserText: null,
    model: null,
    providerId: null,
    thinking: true,
    totalTokens: 0,
    totalCostUsd: 0,
    createdAt: '2026-06-01T00:00:00Z',
    lastActiveAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// ─────────────────────────── Blocks ───────────────────────────

export function makeUserBlock(overrides?: Partial<Block & { kind: 'user' }>): Block {
  return {
    kind: 'user',
    id: 'u-1',
    content: 'Hello',
    createdAt: '2026-06-01T00:00:00Z',
    status: 'sent',
    ...overrides,
  } as Block;
}

export function makeTextBlock(overrides?: Partial<Block & { kind: 'text' }>): Block {
  return {
    kind: 'text',
    id: 't-1',
    content: 'Response text',
    isStreaming: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

export function makeThinkingBlock(overrides?: Partial<Block & { kind: 'thinking' }>): Block {
  return {
    kind: 'thinking',
    id: 'th-1',
    content: 'Thinking...',
    encrypted: false,
    isStreaming: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

export function makeToolCallBlock(overrides?: Partial<Block & { kind: 'tool_call' }>): Block {
  return {
    kind: 'tool_call',
    id: 'tc-1',
    toolCallId: 'toolu-1',
    name: 'Read',
    args: { path: '/some/file.ts' },
    isStreaming: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

export function makeToolResultBlock(overrides?: Partial<Block & { kind: 'tool_result' }>): Block {
  return {
    kind: 'tool_result',
    id: 'tr-1',
    toolCallId: 'toolu-1',
    toolName: 'Read',
    output: 'file contents',
    message: null,
    displayBlocks: [],
    isError: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

export function makeSubagentBlock(overrides?: Partial<Block & { kind: 'subagent' }>): Block {
  return {
    kind: 'subagent',
    id: 'sa-1',
    parentToolCallId: 'toolu-sa',
    subagentType: 'task',
    description: 'Subagent task',
    blocks: [],
    isStreaming: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

export function makeApprovalBlock(
  overrides?: Partial<Block & { kind: 'approval_request' }>,
): Block {
  return {
    kind: 'approval_request',
    id: 'ar-1',
    requestId: 'req-1',
    toolCallId: 'toolu-ar',
    action: 'Run command',
    description: 'Execute shell command',
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

export function makeErrorBlock(overrides?: Partial<Block & { kind: 'error' }>): Block {
  return {
    kind: 'error',
    id: 'err-1',
    code: 'api_error',
    message: 'Something went wrong',
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  } as Block;
}

// ─────────────────────────── Snapshot ───────────────────────────

export function makeSnapshot(overrides?: Partial<SnapshotPayload>): SnapshotPayload {
  return {
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
    ...overrides,
  };
}

// ─────────────────────────── File Entries ───────────────────────────

export function makeFileEntry(overrides?: Partial<FileEntry>): FileEntry {
  return {
    name: 'test.ts',
    type: 'file',
    size: 1024,
    mtime: Date.now(),
    ...overrides,
  };
}

export function makeDirEntry(name: string): FileEntry {
  return { name, type: 'dir', size: 0, mtime: Date.now() };
}
