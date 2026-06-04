/**
 * Shared WebSocket mock for component tests.
 *
 * Usage:
 *   import { mockWS } from '../helpers/mock-ws';
 *   const { sendWS } = mockWS();
 *
 * The mock replaces the ws-client singleton and ws-send utility with vi.fn()
 * so components that import them get no-ops instead of real connections.
 */
import { vi } from 'vitest';

export interface WsMocks {
  sendWS: ReturnType<typeof vi.fn>;
  wsOpen: ReturnType<typeof vi.fn>;
  wsClose: ReturnType<typeof vi.fn>;
  wsConnect: ReturnType<typeof vi.fn>;
}

/**
 * Install WebSocket mocks. Returns the mock functions for assertions.
 */
export function mockWS(): WsMocks {
  const sendWS = vi.fn();
  const wsOpen = vi.fn();
  const wsClose = vi.fn();
  const wsConnect = vi.fn();

  // Mock the ws-client singleton.
  vi.mock('../../lib/ws-client', () => ({
    wsClient: {
      connect: wsConnect,
      close: wsClose,
      on: vi.fn(() => vi.fn()),
      off: vi.fn(),
      state: 'open',
    },
  }));

  // Mock ws-send utility.
  vi.mock('../../lib/ws-send', () => ({
    sendWS,
  }));

  return { sendWS, wsOpen, wsClose, wsConnect };
}
