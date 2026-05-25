import type { WSMessage } from 'shared/types';
import { useChatStore } from './chat-store';
import { router } from './router';
import { wsClient } from './ws-client';

// Singleton module side-effect. Subscribes to the global WebSocket client
// and routes incoming frames to the Zustand chat store.
const unsubscribe = wsClient.on('message', (ev: MessageEvent) => {
  const raw = typeof ev.data === 'string' ? ev.data : '';
  if (!raw) return;

  try {
    const msg = JSON.parse(raw) as WSMessage;
    if (!msg?.type || !msg.sessionId) return;

    if (msg.type === 'snapshot') {
      useChatStore.getState().loadSnapshot(msg.sessionId, msg.payload as any);
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
