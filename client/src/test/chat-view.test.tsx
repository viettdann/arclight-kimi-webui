import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted route state holder ──
const holder = vi.hoisted(() => ({
  id: undefined as string | undefined,
  pathname: '/',
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ id: holder.id }),
    useLocation: () => ({ pathname: holder.pathname }),
  };
});

// Router module builds a real browser router on import; only constants are needed.
vi.mock('@/lib/router', () => ({
  DRAFT_SESSION_PATH: '/session/new',
  DRAFT_WORKDIR_PARAM: 'workDir',
}));

// ── Component mocks ──
vi.mock('@/components/chat-input', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));
vi.mock('@/components/transcript', () => ({
  Transcript: () => <div data-testid="transcript" />,
}));
vi.mock('@/components/welcome-screen', () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}));
vi.mock('@/components/api-status-notices', () => ({
  ApiStatusNotices: () => <div data-testid="api-status-notices" />,
}));
vi.mock('@/components/pending-approval-dock', () => ({
  PendingApprovalDock: () => <div data-testid="pending-approval-dock" />,
}));
vi.mock('@/components/right-sidebar/right-sidebar', () => ({
  RightSidebar: () => <div data-testid="right-sidebar" />,
}));

// ── Store mocks ──
vi.mock('@/lib/sessions-store', () => ({
  useSessionsStore: () => null,
}));
vi.mock('@/lib/open-file-store', () => ({
  useOpenFileStore: (
    sel: (s: {
      openFile: null;
      editorWidthPct: number;
      close: () => void;
      setWidth: () => void;
    }) => unknown,
  ) => sel({ openFile: null, editorWidthPct: 40, close: () => {}, setWidth: () => {} }),
  persistWidth: () => {},
}));

import { ChatView } from '@/pages/chat-view';

afterEach(cleanup);

describe('ChatView — root route (no session, not draft)', () => {
  it('renders WelcomeScreen and ChatInput', () => {
    holder.id = undefined;
    holder.pathname = '/';

    render(<ChatView />);

    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.queryByTestId('transcript')).not.toBeInTheDocument();
    expect(screen.queryByTestId('api-status-notices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-approval-dock')).not.toBeInTheDocument();
  });
});

describe('ChatView — draft route (/session/new)', () => {
  it('renders ChatInput without WelcomeScreen or Transcript', () => {
    holder.id = undefined;
    holder.pathname = '/session/new';

    render(<ChatView />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transcript')).not.toBeInTheDocument();
    expect(screen.queryByTestId('api-status-notices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-approval-dock')).not.toBeInTheDocument();
  });
});

describe('ChatView — session route (/session/:id)', () => {
  it('renders Transcript, ApiStatusNotices, PendingApprovalDock, and ChatInput', () => {
    holder.id = 'sess-42';
    holder.pathname = '/session/sess-42';

    render(<ChatView />);

    expect(screen.getByTestId('transcript')).toBeInTheDocument();
    expect(screen.getByTestId('api-status-notices')).toBeInTheDocument();
    expect(screen.getByTestId('pending-approval-dock')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
  });
});
