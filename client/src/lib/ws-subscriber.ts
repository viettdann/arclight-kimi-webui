import type { CloneProgressPayload, SnapshotPayload, WSMessage } from 'shared/types';
import { useChatStore } from './chat-store';
import { useCloneProgressStore } from './clone-progress-store';
import { useProjectsStore } from './projects-store';
import { router } from './router';
import { wsClient } from './ws-client';

// Singleton module side-effect. Subscribes to the global WebSocket client
// and routes incoming frames to the Zustand chat store.
const unsubscribe = wsClient.on('message', (ev: MessageEvent) => {
  const raw = typeof ev.data === 'string' ? ev.data : '';
  if (!raw) return;

  try {
    const msg = JSON.parse(raw) as WSMessage;
    if (!msg?.type) return;

    // `clone_progress` is user-scoped (no chat session): route it before the
    // sessionId gate that every session-bound frame must pass. Register the
    // project here (not in the modal) so a backgrounded clone still lands in the
    // sidebar after the modal is closed.
    if (msg.type === 'clone_progress') {
      const payload = msg.payload as CloneProgressPayload;
      useCloneProgressStore.getState().apply(payload);
      if (payload.status === 'completed' && payload.workDir) {
        useProjectsStore.getState().addProject({
          name: payload.projectName,
          workDir: payload.workDir,
          origin: 'local',
        });
      }
      return;
    }

    if (!msg.sessionId) return;

    if (msg.type === 'snapshot') {
      useChatStore.getState().loadSnapshot(msg.sessionId, msg.payload as SnapshotPayload);
      void router.navigate(`/session/${msg.sessionId}`);
    } else {
      useChatStore.getState().applyEvent(msg.sessionId, msg.type, msg.payload);
    }
  } catch (err) {
    console.error('Failed to parse or route WS message:', err);
  }
});

// Expose disposer for clean testing/HMR environments.
export const disposeWsSubscriber = (): void => unsubscribe();
