// Singleton WebSocket client. State: idle | connecting | open | reconnecting
// | closed. Halts on auth-failure (4401) and surfaces logout via the auth
// store; reconnects with exponential backoff for transient closes.
//
// Note: importing `useAuthStore` here closes a static cycle
// (auth-store ↔ ws-client). It is safe — the cross-module reference is
// only dereferenced at runtime (inside `handleClose`), well after both
// modules finish initializing.
import { useAuthStore } from './auth-store';

type WsState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

type Listener<T = unknown> = (payload: T) => void;
type Unsubscribe = () => void;

interface Listeners {
  open: Set<Listener<Event>>;
  close: Set<Listener<CloseEvent>>;
  message: Set<Listener<MessageEvent>>;
  error: Set<Listener<Event>>;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER = 0.2;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

class WsClient {
  private socket: WebSocket | null = null;
  private state: WsState = 'idle';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private readonly listeners: Listeners = {
    open: new Set(),
    close: new Set(),
    message: new Set(),
    error: new Set(),
  };

  /** Idempotent. Safe to call from auth subscriber on every authenticated transition. */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'open') return;
    // A pending reconnect timer means a connect attempt is already scheduled —
    // dropping our own call would defer the user-driven `connect` for up to
    // 30s. Cancel the timer and dial immediately.
    this.cancelReconnect();
    this.intentionalClose = false;
    this.openSocket();
  }

  /** Close the socket, halt reconnection, and reset state. Idempotent. */
  close(code = 1000, reason = 'manual'): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.socket) {
      try {
        if (
          this.socket.readyState === WebSocket.OPEN ||
          this.socket.readyState === WebSocket.CONNECTING
        ) {
          this.socket.close(code, reason);
        }
      } catch {
        // swallow — socket may already be closed
      }
      this.socket = null;
    }
    this.state = 'closed';
    this.attempt = 0;
  }

  /** Sends only when open; drops silently otherwise. */
  send(msg: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(msg);
    }
  }

  on<K extends keyof Listeners>(
    event: K,
    handler: K extends 'message'
      ? Listener<MessageEvent>
      : K extends 'close'
        ? Listener<CloseEvent>
        : Listener<Event>,
  ): Unsubscribe {
    const set = this.listeners[event] as Set<Listener<unknown>>;
    set.add(handler as Listener<unknown>);
    return () => {
      set.delete(handler as Listener<unknown>);
    };
  }

  private openSocket(): void {
    this.state = 'connecting';
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      // URL or protocol mismatch — schedule retry via the close path.
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', (ev) => {
      this.state = 'open';
      this.attempt = 0;
      for (const l of this.listeners.open) l(ev);
    });

    socket.addEventListener('message', (ev) => {
      for (const l of this.listeners.message) l(ev);
    });

    socket.addEventListener('error', (ev) => {
      for (const l of this.listeners.error) l(ev);
    });

    socket.addEventListener('close', (ev) => {
      for (const l of this.listeners.close) l(ev);
      this.handleClose(ev.code);
    });
  }

  private handleClose(code: number): void {
    this.socket = null;

    // 4401: server says auth-session is gone. Surface to the store; do not
    // reconnect.
    if (code === 4401) {
      this.state = 'closed';
      this.attempt = 0;
      useAuthStore.getState().clearSession('ws-4401');
      return;
    }

    if (this.intentionalClose || code === 1000) {
      this.state = 'closed';
      this.attempt = 0;
      return;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.state = 'reconnecting';
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempt);
    const jitter = exp * JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(0, exp + jitter);
    // Stop counting once the delay saturates — keeps `2 ** attempt` from
    // drifting toward Infinity during long outages. Cosmetic but bounded.
    if (exp < MAX_BACKOFF_MS) this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;
      this.openSocket();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const wsClient = new WsClient();
