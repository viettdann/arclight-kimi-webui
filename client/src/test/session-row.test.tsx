import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionListItem } from 'shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigate, sendWS, showToast } = vi.hoisted(() => ({
  navigate: vi.fn(),
  sendWS: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: undefined }),
}));
vi.mock('@/lib/ws-send', () => ({ sendWS }));
vi.mock('@/components/toast-provider', () => ({ showToast }));

import { SessionRow } from '@/components/session-row';
import { useDraftStore } from '@/lib/draft-store';
import { useSessionsStore } from '@/lib/sessions-store';

const local = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 'sess-1',
  workDir: '/work/demo',
  projectName: 'demo',
  localWorkDir: '/work/demo',
  origin: 'local',
  title: 'My session',
  firstUserText: null,
  model: null,
  providerId: null,
  thinking: false,
  totalTokens: 0,
  totalCostUsd: 0,
  createdAt: '2026-01-01T00:00:00Z',
  lastActiveAt: '2026-01-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  navigate.mockReset();
  sendWS.mockReset();
  showToast.mockReset();
  useSessionsStore.setState({ remove: vi.fn().mockResolvedValue(undefined) });
  useDraftStore.setState({ drafts: {} });
});
afterEach(cleanup);

describe('SessionRow — attach', () => {
  it('resumes and navigates when a local session row is clicked', async () => {
    const user = userEvent.setup();
    render(<SessionRow session={local()} />);

    await user.click(screen.getByRole('button', { name: 'My session' }));
    expect(sendWS).toHaveBeenCalledWith('resume_session', { sessionId: 'sess-1' });
    expect(navigate).toHaveBeenCalledWith('/session/sess-1');
  });

  it('falls back to the first user prompt for an untitled session', () => {
    render(<SessionRow session={local({ title: null, firstUserText: 'hello there' })} />);
    expect(screen.getByRole('button', { name: 'hello there' })).toBeInTheDocument();
  });
});

describe('SessionRow — foreign restore', () => {
  it('opens the restore dialog instead of attaching directly', async () => {
    const user = userEvent.setup();
    render(
      <SessionRow
        session={local({ origin: 'foreign', workDir: '/remote/demo', localWorkDir: '/local/demo' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'My session' }));
    expect(sendWS).not.toHaveBeenCalled();
    expect(screen.getByText('Restore session on this machine?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(sendWS).toHaveBeenCalledWith('resume_session', { sessionId: 'sess-1' });
    expect(navigate).toHaveBeenCalledWith('/session/sess-1');
  });
});

describe('SessionRow — delete', () => {
  it('removes the session and toasts after confirming from the actions menu', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(undefined);
    useSessionsStore.setState({ remove });
    useDraftStore.setState({ drafts: { 'sess-1': 'leftover draft' } });

    render(<SessionRow session={local()} />);

    await user.click(screen.getByRole('button', { name: 'Actions for My session' }));
    await user.click(await screen.findByText('Delete Task'));

    // Confirmation dialog opens; confirm the destructive action.
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(remove).toHaveBeenCalledWith('sess-1');
    expect(showToast).toHaveBeenCalledWith({ message: 'Session deleted', type: 'info' });
    // The persisted composer draft is dropped on delete.
    expect(useDraftStore.getState().drafts['sess-1']).toBeUndefined();
  });
});
