import type {
  CloneProgressPayload,
  CommandsAvailablePayload,
  SnapshotPayload,
  ToolCallPayload,
  ToolResultPayload,
  WSMessage,
} from 'shared/types';
import { showToast } from '@/components/toast-provider';
import { useChatStore } from './chat-store';
import { useCloneProgressStore } from './clone-progress-store';
import { useCommandStore } from './command-store';
import { useGitPanelStore } from './git-panel-store';
import { cloneErrorMessage, useProjectsStore } from './projects-store';
import { useRightSidebarStore } from './right-sidebar-store';
import { router } from './router';
import { useSessionsStore } from './sessions-store';
import { wsClient } from './ws-client';

// A `turn_end` means the agent likely touched the working tree. Refresh the git
// panel's status, but only when it's the active project AND the panel is open,
// and debounced so a burst of turns coalesces into one refresh.
// Tools that can mutate the working tree. We refresh the git panel the moment
// one of these finishes (tool_result), so file changes appear live during a turn
// rather than only at turn_end. The name lives on tool_call, so we remember the
// call id there and fire when its result lands.
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);
const pendingMutatingCalls = new Set<string>();

let gitRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleGitRefresh(sessionId: string): void {
  const session = useSessionsStore.getState().sessions.find((s) => s.id === sessionId);
  if (!session) return;
  if (session.projectName !== useGitPanelStore.getState().projectName) return;
  if (!useRightSidebarStore.getState().open) return;

  if (gitRefreshTimer) clearTimeout(gitRefreshTimer);
  gitRefreshTimer = setTimeout(() => {
    gitRefreshTimer = null;
    // Bash may have run git itself (commit/pull/checkout), which moves history
    // and branch heads — refresh those too, not just the file tree.
    const git = useGitPanelStore.getState();
    void git.refreshStatus();
    void git.refreshBranches();
    void git.refreshLog();
  }, 500);
}

// Singleton module side-effect. Subscribes to the global WebSocket client
// and routes incoming frames to the Zustand chat store.
const unsubscribeMessage = wsClient.on('message', (ev: MessageEvent) => {
  const raw = typeof ev.data === 'string' ? ev.data : '';
  if (!raw) return;

  try {
    const msg = JSON.parse(raw) as WSMessage;
    if (!msg?.type) return;

    // `clone_progress` is user-scoped (no chat session): route it before the
    // sessionId gate that every session-bound frame must pass. The project list
    // is driven here (not in the modal) so a backgrounded clone still surfaces
    // and resolves in the sidebar after the modal is closed.
    if (msg.type === 'clone_progress') {
      const payload = msg.payload as CloneProgressPayload;
      useCloneProgressStore.getState().apply(payload);
      const projects = useProjectsStore.getState();
      if (payload.status === 'cloning') {
        projects.upsertCloning({
          name: payload.projectName,
          workDir: payload.workDir,
          origin: 'local',
        });
      } else if (payload.status === 'completed') {
        projects.addProject({
          name: payload.projectName,
          workDir: payload.workDir,
          origin: 'local',
        });
      } else if (payload.status === 'failed') {
        projects.dropProject(payload.projectName);
        // A user-initiated cancel is terminal but not an error — drop silently.
        if (payload.errorCode !== 'clone_canceled') {
          showToast({
            message: `${cloneErrorMessage(payload.errorCode)}${payload.error ? `: ${payload.error}` : ''}`,
            type: 'error',
          });
        }
      }
      return;
    }

    if (!msg.sessionId) return;

    // A completed turn may have changed files; nudge the git panel (no-op unless
    // it's the active, open project). Does not consume the event.
    if (msg.type === 'turn_end') scheduleGitRefresh(msg.sessionId);

    // Finer-grained: refresh the moment a file-mutating tool finishes, so the
    // panel tracks changes mid-turn instead of waiting for turn_end. Neither
    // branch consumes the event — both fall through to applyEvent below.
    if (msg.type === 'tool_call') {
      const p = msg.payload as ToolCallPayload;
      if (MUTATING_TOOLS.has(p.name)) pendingMutatingCalls.add(p.id);
    } else if (msg.type === 'tool_result') {
      const p = msg.payload as ToolResultPayload;
      if (pendingMutatingCalls.delete(p.toolCallId)) scheduleGitRefresh(msg.sessionId);
    }

    if (msg.type === 'snapshot') {
      const payload = msg.payload as SnapshotPayload;
      useChatStore.getState().loadSnapshot(msg.sessionId, payload);
      useCommandStore.getState().setCommands(msg.sessionId, payload.commands ?? []);
      void router.navigate(`/session/${msg.sessionId}`);
    } else if (msg.type === 'commands_available') {
      // Routed before applyEvent so the catalog lands in the command store
      // instead of being mis-applied as a chat block event.
      useCommandStore
        .getState()
        .setCommands(msg.sessionId, (msg.payload as CommandsAvailablePayload).commands);
    } else {
      useChatStore.getState().applyEvent(msg.sessionId, msg.type, msg.payload, msg.seq);
    }
  } catch (err) {
    console.error('Failed to parse or route WS message:', err);
  }
});

// On reconnect, re-fetch the project list. `clone_progress` has no replay
// buffer, so a terminal frame sent while the socket was down is lost — a refetch
// reconciles a clone that finished (or failed) during the gap. Skip the very
// first open: the sidebar already fetches on mount.
let connectedBefore = false;
const unsubscribeOpen = wsClient.on('open', () => {
  if (!connectedBefore) {
    connectedBefore = true;
    return;
  }
  void useProjectsStore.getState().fetch();
});

// Expose disposer for clean testing/HMR environments.
export const disposeWsSubscriber = (): void => {
  unsubscribeMessage();
  unsubscribeOpen();
};
