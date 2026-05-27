import type {
  Block,
  DisplayBlock,
  SessionStatus,
  SlashCommand,
  SlashCommandsPayload,
  SnapshotPayload,
  WSMessageType,
} from 'shared/types';
import { create } from 'zustand';

export interface ChatSessionState {
  blocks: Block[];
  status: SessionStatus;
  tokenUsage: number | null;
  contextUsage: number | null;
  title: string | null;
  slashCommands: SlashCommand[];
  pendingPrompt: { text: string; enqueuedAt: string } | null;
  isTurnInProgress: boolean;
  /** Per-session agent flags, mirrored from the snapshot (true server state). */
  thinking: boolean;
  yoloMode: boolean;
  liveTurnIdx: number | null;
  liveStepIdx: number | null;
  subagentStates: Record<string, { liveTurnIdx: number | null; liveStepIdx: number | null }>;
}

interface ChatStore {
  sessions: Record<string, ChatSessionState>;
  getOrCreateSession: (sessionId: string) => ChatSessionState;
  loadSnapshot: (sessionId: string, payload: SnapshotPayload) => void;
  applyEvent: (sessionId: string, type: WSMessageType, payload: any) => void;
  addPendingUserBlock: (sessionId: string, text: string) => void;
  /** Optimistic local update of agent flags; server echoes the truth via snapshot. */
  setSessionFlags: (sessionId: string, flags: { thinking?: boolean; yoloMode?: boolean }) => void;
}

const createDefaultSessionState = (): ChatSessionState => ({
  blocks: [],
  status: 'idle',
  tokenUsage: null,
  contextUsage: null,
  title: null,
  slashCommands: [],
  pendingPrompt: null,
  isTurnInProgress: false,
  thinking: true,
  yoloMode: false,
  liveTurnIdx: null,
  liveStepIdx: null,
  subagentStates: {},
});

function findToolCallNameInBlocks(blocks: Block[], toolCallId: string): string {
  for (const b of blocks) {
    if (b.kind === 'tool_call' && b.toolCallId === toolCallId) {
      return b.name;
    }
    if (b.kind === 'subagent') {
      const nestedName = findToolCallNameInBlocks(b.blocks, toolCallId);
      if (nestedName) return nestedName;
    }
  }
  return '';
}

function applyEventToBlocks(
  blocks: Block[],
  type: WSMessageType,
  payload: any,
  context: {
    liveTurnIdx: number | null;
    liveStepIdx: number | null;
    setLiveTurnIdx: (val: number | null) => void;
    setLiveStepIdx: (val: number | null) => void;
    findToolCallName: (toolCallId: string) => string;
    applySubagentEvent?: (parentToolCallId: string, nestedEvent: any) => void;
  },
): Block[] {
  let updatedBlocks = [...blocks];

  switch (type) {
    case 'turn_begin': {
      const userBlock: Block = {
        kind: 'user',
        id: `user:wire:${(context.liveTurnIdx ?? -1) + 1}`,
        content: typeof payload === 'string' ? payload : (payload.userInput ?? ''),
        createdAt: new Date().toISOString(),
        status: 'sent',
      };
      // Remove any pending user block
      updatedBlocks = updatedBlocks.filter((b) => b.kind !== 'user' || b.status !== 'pending');
      updatedBlocks.push(userBlock);
      context.setLiveTurnIdx((context.liveTurnIdx ?? -1) + 1);
      context.setLiveStepIdx(0);
      break;
    }
    case 'step_begin': {
      // Mark text/thinking block of previous step isStreaming = false
      updatedBlocks = updatedBlocks.map((b) => {
        if ((b.kind === 'text' || b.kind === 'thinking') && b.isStreaming) {
          return { ...b, isStreaming: false };
        }
        return b;
      });
      const nextStep =
        typeof payload?.stepNumber === 'number'
          ? payload.stepNumber
          : (context.liveStepIdx ?? -1) + 1;
      context.setLiveStepIdx(nextStep);
      break;
    }
    case 'text_delta': {
      const turn = context.liveTurnIdx ?? 0;
      const step = context.liveStepIdx ?? 0;
      const text = typeof payload === 'string' ? payload : (payload.text ?? '');
      // partIdx disambiguates multiple text segments within (turn, step) so a
      // second text section (after a tool call) does not append to the first.
      const partIdx =
        typeof payload === 'object' && typeof payload.partIdx === 'number' ? payload.partIdx : 0;
      const existingIdx = updatedBlocks.findIndex(
        (b) =>
          b.kind === 'text' && b.turnIdx === turn && b.stepIdx === step && b.partIdx === partIdx,
      );
      if (existingIdx >= 0) {
        const existing = updatedBlocks[existingIdx] as Extract<Block, { kind: 'text' }>;
        updatedBlocks[existingIdx] = {
          ...existing,
          content: existing.content + text,
          isStreaming: true,
        };
      } else {
        const newBlock: Block = {
          kind: 'text',
          id: `text:${turn}:${step}:${partIdx}`,
          turnIdx: turn,
          stepIdx: step,
          partIdx,
          content: text,
          isStreaming: true,
          createdAt: new Date().toISOString(),
        };
        updatedBlocks.push(newBlock);
      }
      break;
    }
    case 'thinking_delta': {
      const turn = context.liveTurnIdx ?? 0;
      const step = context.liveStepIdx ?? 0;
      const thinking = typeof payload === 'string' ? payload : (payload.thinking ?? '');
      const encrypted = typeof payload === 'object' ? !!payload.encrypted : false;
      const partIdx =
        typeof payload === 'object' && typeof payload.partIdx === 'number' ? payload.partIdx : 0;
      const existingIdx = updatedBlocks.findIndex(
        (b) =>
          b.kind === 'thinking' &&
          b.turnIdx === turn &&
          b.stepIdx === step &&
          b.partIdx === partIdx,
      );
      if (existingIdx >= 0) {
        const existing = updatedBlocks[existingIdx] as Extract<Block, { kind: 'thinking' }>;
        updatedBlocks[existingIdx] = {
          ...existing,
          content: existing.content + thinking,
          isStreaming: true,
        };
      } else {
        const newBlock: Block = {
          kind: 'thinking',
          id: `thinking:${turn}:${step}:${partIdx}`,
          turnIdx: turn,
          stepIdx: step,
          partIdx,
          content: thinking,
          encrypted,
          isStreaming: true,
          createdAt: new Date().toISOString(),
        };
        updatedBlocks.push(newBlock);
      }
      break;
    }
    case 'tool_call': {
      const newBlock: Block = {
        kind: 'tool_call',
        id: `tool_call:${payload.id}`,
        toolCallId: payload.id,
        name: payload.name,
        args: payload.arguments,
        isStreaming: false,
        createdAt: new Date().toISOString(),
      };
      updatedBlocks.push(newBlock);
      break;
    }
    case 'tool_call_delta': {
      const existingIdx = updatedBlocks.findIndex(
        (b) => b.kind === 'tool_call' && b.toolCallId === payload.id,
      );
      if (existingIdx >= 0) {
        const existing = updatedBlocks[existingIdx] as Extract<Block, { kind: 'tool_call' }>;
        // Don't re-arm isStreaming if the result has already arrived (late delta).
        const hasResult = updatedBlocks.some(
          (b) => b.kind === 'tool_result' && b.toolCallId === payload.id,
        );
        updatedBlocks[existingIdx] = {
          ...existing,
          argsStreaming: (existing.argsStreaming ?? '') + payload.argumentsPart,
          isStreaming: !hasResult,
        };
      }
      break;
    }
    case 'tool_result': {
      const toolName = context.findToolCallName(payload.toolCallId);
      const newBlock: Block = {
        kind: 'tool_result',
        id: `tool_result:${payload.toolCallId}`,
        toolCallId: payload.toolCallId,
        toolName,
        output: payload.output,
        message: payload.message ?? null,
        displayBlocks: (payload.displayBlocks as DisplayBlock[]) ?? [],
        isError: payload.isError,
        createdAt: new Date().toISOString(),
      };
      // Mark tool call as not streaming
      updatedBlocks = updatedBlocks.map((b) => {
        if (b.kind === 'tool_call' && b.toolCallId === payload.toolCallId) {
          return { ...b, isStreaming: false };
        }
        return b;
      });
      updatedBlocks.push(newBlock);
      break;
    }
    case 'approval_request': {
      const newBlock: Block = {
        kind: 'approval_request',
        id: `approval:${payload.requestId}`,
        requestId: payload.requestId,
        toolCallId: payload.id,
        action: payload.action,
        description: payload.description,
        createdAt: new Date().toISOString(),
      };
      updatedBlocks.push(newBlock);
      break;
    }
    case 'approval_response': {
      updatedBlocks = updatedBlocks.map((b) => {
        if (b.kind === 'approval_request' && b.requestId === payload.requestId) {
          return { ...b, resolution: payload.response };
        }
        return b;
      });
      break;
    }
    case 'question_request': {
      const newBlock: Block = {
        kind: 'question_request',
        id: `question:${payload.requestId}`,
        requestId: payload.requestId,
        // QuestionRequestPayload.id carries the SDK tool_call_id (see ws/events.ts).
        toolCallId: payload.id,
        questions: payload.questions,
        createdAt: new Date().toISOString(),
      };
      updatedBlocks.push(newBlock);
      break;
    }
    case 'steer_input': {
      const steerCount = updatedBlocks.filter((b) => b.kind === 'steer').length;
      const newBlock: Block = {
        kind: 'steer',
        id: `steer:${steerCount}`,
        content: payload.content,
        createdAt: new Date().toISOString(),
      };
      updatedBlocks.push(newBlock);
      break;
    }
    case 'subagent_event': {
      if (context.applySubagentEvent) {
        context.applySubagentEvent(payload.parentToolCallId, payload.event);
      }
      break;
    }
    case 'step_interrupted':
    case 'turn_end': {
      updatedBlocks = updatedBlocks.map((b) => {
        if (
          (b.kind === 'text' ||
            b.kind === 'thinking' ||
            b.kind === 'tool_call' ||
            b.kind === 'subagent') &&
          b.isStreaming
        ) {
          return { ...b, isStreaming: false };
        }
        return b;
      });
      break;
    }
    case 'error': {
      const newBlock: Block = {
        kind: 'error',
        id: `error:${Date.now()}`,
        code: payload.code,
        message: payload.message,
        createdAt: new Date().toISOString(),
      };
      updatedBlocks.push(newBlock);
      break;
    }
    default:
      break;
  }

  return updatedBlocks;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},

  getOrCreateSession: (sessionId: string) => {
    const state = get();
    if (!state.sessions[sessionId]) {
      // Initialize if missing
      set((s) => {
        const sessions = { ...s.sessions };
        sessions[sessionId] = createDefaultSessionState();
        return { sessions };
      });
    }
    return get().sessions[sessionId]!;
  },

  loadSnapshot: (sessionId: string, payload: SnapshotPayload) => {
    set((state) => {
      const sessions = { ...state.sessions };
      sessions[sessionId] = {
        blocks: payload.blocks,
        status: payload.status,
        tokenUsage: payload.totalTokens,
        contextUsage: null,
        title: payload.title,
        slashCommands: payload.slashCommands ?? [],
        pendingPrompt: payload.pendingPrompt,
        isTurnInProgress: payload.live.turnInProgress,
        thinking: payload.thinking ?? true,
        yoloMode: payload.yoloMode ?? false,
        liveTurnIdx: payload.live.turnIdx,
        liveStepIdx: payload.live.stepIdx,
        subagentStates: {},
      };
      return { sessions };
    });
  },

  applyEvent: (sessionId: string, type: WSMessageType, payload: any) => {
    // Ensure session is initialized
    get().getOrCreateSession(sessionId);

    set((state) => {
      const sessions = { ...state.sessions };
      const session = { ...sessions[sessionId]! };

      // Copy subagentStates to edit
      const subagentStates = { ...session.subagentStates };

      // Helper context for blocks folder
      const context = {
        liveTurnIdx: session.liveTurnIdx,
        liveStepIdx: session.liveStepIdx,
        setLiveTurnIdx: (val: number | null) => {
          session.liveTurnIdx = val;
        },
        setLiveStepIdx: (val: number | null) => {
          session.liveStepIdx = val;
        },
        findToolCallName: (toolCallId: string) => {
          return findToolCallNameInBlocks(session.blocks, toolCallId);
        },
        applySubagentEvent: (parentToolCallId: string, nestedEvent: any) => {
          // 1. Ensure subagent block exists
          let subagentIdx = session.blocks.findIndex(
            (b) => b.kind === 'subagent' && b.parentToolCallId === parentToolCallId,
          );

          if (subagentIdx < 0) {
            // Find parent tool_call index
            const toolCallIdx = session.blocks.findIndex(
              (b) => b.kind === 'tool_call' && b.toolCallId === parentToolCallId,
            );
            if (toolCallIdx >= 0) {
              const newSubagentBlock: Block = {
                kind: 'subagent',
                id: `subagent:${parentToolCallId}`,
                parentToolCallId,
                blocks: [],
                isStreaming: true,
                createdAt: new Date().toISOString(),
              };
              session.blocks = [
                ...session.blocks.slice(0, toolCallIdx + 1),
                newSubagentBlock,
                ...session.blocks.slice(toolCallIdx + 1),
              ];
              subagentIdx = toolCallIdx + 1;
            }
          }

          // If still not found (no parent tool_call either), we ignore or append
          if (subagentIdx < 0) {
            const newSubagentBlock: Block = {
              kind: 'subagent',
              id: `subagent:${parentToolCallId}`,
              parentToolCallId,
              blocks: [],
              isStreaming: true,
              createdAt: new Date().toISOString(),
            };
            session.blocks = [...session.blocks, newSubagentBlock];
            subagentIdx = session.blocks.length - 1;
          }

          const subagentBlock = { ...session.blocks[subagentIdx]! } as Extract<
            Block,
            { kind: 'subagent' }
          >;

          // 2. Initialize subagent states if not present
          if (!subagentStates[parentToolCallId]) {
            subagentStates[parentToolCallId] = {
              liveTurnIdx: null,
              liveStepIdx: null,
            };
          }
          const subState = { ...subagentStates[parentToolCallId]! };

          // 3. Recurse event applying to subagent blocks
          const subContext = {
            liveTurnIdx: subState.liveTurnIdx,
            liveStepIdx: subState.liveStepIdx,
            setLiveTurnIdx: (val: number | null) => {
              subState.liveTurnIdx = val;
            },
            setLiveStepIdx: (val: number | null) => {
              subState.liveStepIdx = val;
            },
            findToolCallName: (toolCallId: string) => {
              return findToolCallNameInBlocks(subagentBlock.blocks, toolCallId);
            },
          };

          subagentBlock.blocks = applyEventToBlocks(
            subagentBlock.blocks,
            nestedEvent.type,
            nestedEvent.payload,
            subContext,
          );

          // If nested event indicates turn/step finished or subagent complete, we can update flags
          if (nestedEvent.type === 'turn_end' || nestedEvent.type === 'step_interrupted') {
            subagentBlock.isStreaming = false;
          } else {
            subagentBlock.isStreaming = true;
          }

          // Write back
          subagentStates[parentToolCallId] = subState;
          session.blocks = [
            ...session.blocks.slice(0, subagentIdx),
            subagentBlock,
            ...session.blocks.slice(subagentIdx + 1),
          ];
        },
      };

      // Apply the main event to top-level blocks
      session.blocks = applyEventToBlocks(session.blocks, type, payload, context);

      // Handle top-level metadata and lifecycle actions
      switch (type) {
        case 'turn_begin':
          session.pendingPrompt = null;
          session.isTurnInProgress = true;
          break;
        case 'step_interrupted':
          break;
        case 'turn_end':
          session.isTurnInProgress = false;
          // Set all streaming subagent blocks to false
          session.blocks = session.blocks.map((b) => {
            if (b.kind === 'subagent') {
              return { ...b, isStreaming: false };
            }
            return b;
          });
          break;
        case 'status_update':
          if (payload) {
            session.tokenUsage = payload.tokenUsage;
            session.contextUsage = payload.contextUsage;
          }
          break;
        case 'title_update':
          if (payload?.title) {
            session.title = payload.title;
          }
          break;
        case 'slash_commands': {
          const commands = (payload as SlashCommandsPayload)?.commands;
          if (Array.isArray(commands)) {
            session.slashCommands = commands;
          }
          break;
        }
        case 'error':
          session.isTurnInProgress = false;
          break;
        case 'session_state':
          if (payload?.state) {
            session.status = payload.state;
          }
          break;
        default:
          break;
      }

      session.subagentStates = subagentStates;
      sessions[sessionId] = session;
      return { sessions };
    });
  },

  addPendingUserBlock: (sessionId: string, text: string) => {
    get().getOrCreateSession(sessionId);
    set((state) => {
      const sessions = { ...state.sessions };
      const session = { ...sessions[sessionId]! };

      const pendingBlock: Block = {
        kind: 'user',
        id: `user:pending:${sessionId}`,
        content: text,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      const filtered = session.blocks.filter((b) => b.id !== `user:pending:${sessionId}`);
      session.blocks = [...filtered, pendingBlock];
      session.pendingPrompt = { text, enqueuedAt: new Date().toISOString() };

      sessions[sessionId] = session;
      return { sessions };
    });
  },

  setSessionFlags: (sessionId, flags) => {
    get().getOrCreateSession(sessionId);
    set((state) => {
      const sessions = { ...state.sessions };
      const session = { ...sessions[sessionId]! };
      if (flags.thinking !== undefined) session.thinking = flags.thinking;
      if (flags.yoloMode !== undefined) session.yoloMode = flags.yoloMode;
      sessions[sessionId] = session;
      return { sessions };
    });
  },
}));

export function useSessionChat(sessionId: string | undefined): ChatSessionState | null {
  return useChatStore((state) => {
    if (!sessionId) return null;
    return state.sessions[sessionId] ?? null;
  });
}
