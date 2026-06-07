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

// Application-level heartbeat. The browser WebSocket API hides protocol
// ping/pong from JS, so a silently-dropped connection (mobile background, NAT
// timeout, network change) leaves the socket stuck in OPEN — a "zombie" the
// reactive `close`-driven reconnect never notices. We send a `ping` every
// PING_INTERVAL_MS; the server's `pong` (or ANY inbound frame) proves liveness.
// If nothing arrives within PONG_TIMEOUT_MS of a ping, the socket is dead — tear
// it down and reconnect immediately.
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const PING_FRAME = JSON.stringify({ type: 'ping', payload: {}, sessionId: '', seq: 0 });

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
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private readonly listeners: Listeners = {
    open: new Set(),
    close: new Set(),
    message: new Set(),
    error: new Set(),
  };

  constructor() {
    // Proactive recovery: when the tab returns to the foreground, the network
    // comes back, or the page is restored from the bfcache, a zombie socket must
    // be detected without waiting for the next 25s heartbeat tick. These fire on
    // exactly the transitions that strand a mobile/idle connection.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onWake);
      window.addEventListener('pageshow', this.onWake);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.onWake();
      });
    }
  }

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
    this.stopHeartbeat();
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
  send(msg: string | Blob | BufferSource): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(msg);
    }
  }

  /** True iff the socket is currently in OPEN state. */
  isOpen(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
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
      if (this.socket !== socket) return;
      this.state = 'open';
      this.attempt = 0;
      this.startHeartbeat();
      for (const l of this.listeners.open) l(ev);
    });

    socket.addEventListener('message', (ev) => {
      // Drop frames from a socket we've already replaced (see the close guard).
      if (this.socket !== socket) return;
      // Any inbound frame proves the connection is alive — clear the pong wait
      // regardless of frame type (`pong` is just the cheapest such proof).
      this.noteActivity();
      for (const l of this.listeners.message) l(ev);
    });

    socket.addEventListener('error', (ev) => {
      if (this.socket !== socket) return;
      for (const l of this.listeners.error) l(ev);
    });

    socket.addEventListener('close', (ev) => {
      // Ignore close events from a socket we've already replaced (forceReconnect
      // closes the stale one AFTER dialing the new). Acting on them would null
      // out the live socket and schedule a spurious backoff.
      if (this.socket !== socket) return;
      this.stopHeartbeat();
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

  // ─────────────────────────── heartbeat ───────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    this.awaitingPong = false;
  }

  /** An inbound frame arrived: the socket is alive, so cancel the pong deadline. */
  private noteActivity(): void {
    this.awaitingPong = false;
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /** Send a ping and arm the pong deadline. No-op if a probe is already pending. */
  private sendPing(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.awaitingPong) return;
    try {
      this.socket.send(PING_FRAME);
    } catch {
      // Socket died between the readyState check and send — recover now.
      this.forceReconnect();
      return;
    }
    this.awaitingPong = true;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      // No frame of any kind since the ping → the connection is a zombie.
      if (this.awaitingPong) this.forceReconnect();
    }, PONG_TIMEOUT_MS);
  }

  /**
   * Tear down the current (presumed-dead) socket and dial a fresh one
   * immediately, bypassing the backoff schedule. The stale socket is closed
   * AFTER the new one is assigned so its `close` handler — which checks identity
   * — skips both the listener fan-out and the backoff path.
   */
  private forceReconnect(): void {
    if (this.intentionalClose) return;
    this.stopHeartbeat();
    this.cancelReconnect();
    const stale = this.socket;
    this.socket = null;
    this.attempt = 0;
    this.openSocket();
    if (stale) {
      try {
        stale.close(4000, 'stale');
      } catch {
        // already closed — nothing to do
      }
    }
  }

  /**
   * Foreground / network-restored / bfcache-restore hook. Recovers a connection
   * that should be live but may have silently died while the tab was hidden or
   * offline. An idle/closed client (logged out or intentionally closed) is left
   * untouched — reconnection is the auth subscriber's call, not ours.
   */
  private onWake = (): void => {
    if (this.intentionalClose) return;
    switch (this.state) {
      case 'open':
        if (this.socket?.readyState === WebSocket.OPEN) {
          // Looks open, but might be a zombie — probe now instead of waiting up
          // to 25s for the next heartbeat. A dead socket trips the pong deadline.
          this.sendPing();
        } else {
          // State/socket desync (socket closing or gone) — re-dial.
          this.forceReconnect();
        }
        break;
      case 'reconnecting':
        // A backoff timer is pending, possibly throttled while backgrounded —
        // skip the wait and dial immediately now that we're back.
        this.forceReconnect();
        break;
      // 'connecting': a dial is already in flight — let it settle.
      // 'idle' / 'closed': nothing to recover (logged out or intentional close).
    }
  };
}

export const wsClient = new WsClient();
