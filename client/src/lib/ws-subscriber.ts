import type {
  CloneProgressPayload,
  CommandsAvailablePayload,
  SnapshotPayload,
  WSMessage,
} from 'shared/types';
import { showToast } from '@/components/toast-provider';
import { useChatStore } from './chat-store';
import { useCloneProgressStore } from './clone-progress-store';
import { useCommandStore } from './command-store';
import { cloneErrorMessage, useProjectsStore } from './projects-store';
import { router } from './router';
import { wsClient } from './ws-client';

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
