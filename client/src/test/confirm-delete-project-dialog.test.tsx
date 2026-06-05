import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectStatResponse, ProjectSummary, SessionListItem } from 'shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDeleteProjectDialog } from '@/components/confirm-delete-project-dialog';

// The dialog lazily fetches a folder/git snapshot on open via authFetch.
const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/auth-fetch', () => ({ authFetch }));

const project: ProjectSummary = { name: 'demo', workDir: '/work/demo', origin: 'local' };

const stat: ProjectStatResponse = {
  exists: true,
  entryCount: 3,
  git: { branch: 'main', dirtyCount: 2, remote: 'git@github.com:o/r.git' },
};

const session = (id: string, title: string): SessionListItem => ({
  id,
  workDir: '/work/demo',
  projectName: 'demo',
  localWorkDir: '/work/demo',
  origin: 'local',
  title,
  firstUserText: null,
  model: null,
  providerId: null,
  thinking: false,
  totalTokens: 0,
  totalCostUsd: 0,
  createdAt: '2026-01-01T00:00:00Z',
  lastActiveAt: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => stat });
});
afterEach(cleanup);

const base = {
  isOpen: true as const,
  project,
  onConfirm: async () => {},
  onClose: () => {},
};

describe('ConfirmDeleteProjectDialog — folder snapshot', () => {
  it('renders the git/folder snapshot fetched on open', async () => {
    render(<ConfirmDeleteProjectDialog {...base} sessions={[]} />);
    expect(await screen.findByText(/3 items in folder/)).toBeInTheDocument();
    expect(screen.getByText(/git: main/)).toBeInTheDocument();
    expect(screen.getByText(/2 uncommitted changes/)).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledWith('/api/projects/demo/stat');
  });
});

describe('ConfirmDeleteProjectDialog — no sessions', () => {
  it('deletes on a plain click without an acknowledgement', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ConfirmDeleteProjectDialog
        {...base}
        sessions={[]}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    await screen.findByText('No sessions in this project.');

    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeEnabled();
    await user.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDeleteProjectDialog — with sessions', () => {
  it('lists the sessions and gates delete behind the acknowledgement', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDeleteProjectDialog
        {...base}
        sessions={[session('s1', 'Alpha'), session('s2', 'Beta')]}
        onConfirm={onConfirm}
      />,
    );
    await screen.findByText(/3 items in folder/);

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/2 sessions will be permanently deleted/)).toBeInTheDocument();

    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(del).toBeEnabled();
    await user.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('collapses a long session list with an overflow count', async () => {
    const sessions = Array.from({ length: 10 }, (_, i) => session(`s${i}`, `Title ${i}`));
    render(<ConfirmDeleteProjectDialog {...base} sessions={sessions} />);
    await screen.findByText(/items in folder/);
    // 8 shown + a "+2 more" row.
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(screen.getByText('Title 0')).toBeInTheDocument();
    expect(screen.queryByText('Title 9')).toBeNull();
  });
});

describe('ConfirmDeleteProjectDialog — failure', () => {
  it('surfaces the error and stays open when the delete rejects', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('delete exploded'));
    const onClose = vi.fn();
    render(
      <ConfirmDeleteProjectDialog
        {...base}
        sessions={[]}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    await screen.findByText('No sessions in this project.');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('delete exploded')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
