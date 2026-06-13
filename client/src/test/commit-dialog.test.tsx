import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchGitStatus = vi.fn();
const fetchGitBranches = vi.fn();
const fetchGitLog = vi.fn();
const fetchProjectGitMetadata = vi.fn();
const commitGit = vi.fn();

vi.mock('@/api/git', () => ({
  fetchGitStatus: (...args: unknown[]) => fetchGitStatus(...args),
  fetchGitBranches: (...args: unknown[]) => fetchGitBranches(...args),
  fetchGitLog: (...args: unknown[]) => fetchGitLog(...args),
  fetchProjectGitMetadata: (...args: unknown[]) => fetchProjectGitMetadata(...args),
  commitGit: (...args: unknown[]) => commitGit(...args),
  linkGitCredential: vi.fn().mockResolvedValue(undefined),
  executeGitCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  NotGitRepoError: class NotGitRepoError extends Error {},
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CommitDialog } from '@/components/right-sidebar/commit-dialog';
import { useAuthStore } from '@/lib/auth-store';
import { useGitPanelStore } from '@/lib/git-panel-store';

beforeEach(() => {
  vi.clearAllMocks();
  fetchGitStatus.mockResolvedValue({ entries: [], ahead: 0, behind: 0 });
  fetchGitBranches.mockResolvedValue({ branches: [], current: 'main' });
  fetchGitLog.mockResolvedValue({ entries: [] });
  fetchProjectGitMetadata.mockResolvedValue(null);
  commitGit.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

  useAuthStore.setState({ user: { id: 'u1', email: 'dev@example.com', name: 'Dev' } });
  useGitPanelStore.setState({
    projectName: 'proj',
    status: 'ready',
    isBusy: false,
    statusData: null,
    branchData: null,
    logData: null,
  });
});

afterEach(cleanup);

describe('CommitDialog — message input', () => {
  it('does not clear the typed message when a background status refresh updates entries', async () => {
    const user = userEvent.setup();

    // Seed the store with an entry so the textarea is enabled.
    useGitPanelStore.setState({
      statusData: {
        branch: 'main',
        entries: [{ path: 'file.ts', statusCode: 'M ' }],
        ahead: 0,
        behind: 0,
      },
    });
    fetchGitStatus.mockResolvedValueOnce({
      branch: 'main',
      entries: [{ path: 'file.ts', statusCode: 'M ' }],
      ahead: 0,
      behind: 0,
    });

    const { rerender } = render(<CommitDialog open={false} onOpenChange={() => {}} />);
    rerender(<CommitDialog open={true} onOpenChange={() => {}} />);

    // Wait for the open-time refresh to settle.
    await waitFor(() => expect(fetchGitStatus).toHaveBeenCalledTimes(1));

    const textarea = screen.getByPlaceholderText('Commit message');
    await user.type(textarea, 'fix the bug');
    expect(textarea).toHaveValue('fix the bug');

    // Simulate a background status refresh that returns new entries.
    useGitPanelStore.setState({
      statusData: {
        branch: 'main',
        entries: [
          { path: 'file.ts', statusCode: 'M ' },
          { path: 'other.ts', statusCode: '??' },
        ],
        ahead: 0,
        behind: 0,
      },
    });

    // The message must survive the entries update.
    expect(textarea).toHaveValue('fix the bug');
  });

  it('resets the message when the dialog is reopened after being closed', async () => {
    const user = userEvent.setup();

    useGitPanelStore.setState({
      statusData: {
        branch: 'main',
        entries: [{ path: 'file.ts', statusCode: 'M ' }],
        ahead: 0,
        behind: 0,
      },
    });
    fetchGitStatus.mockResolvedValue({
      branch: 'main',
      entries: [{ path: 'file.ts', statusCode: 'M ' }],
      ahead: 0,
      behind: 0,
    });

    const { rerender } = render(<CommitDialog open={true} onOpenChange={() => {}} />);
    await waitFor(() => expect(fetchGitStatus).toHaveBeenCalledTimes(1));

    const textarea = screen.getByPlaceholderText('Commit message');
    await user.type(textarea, 'first draft');
    expect(textarea).toHaveValue('first draft');

    // Close and reopen.
    rerender(<CommitDialog open={false} onOpenChange={() => {}} />);
    rerender(<CommitDialog open={true} onOpenChange={() => {}} />);

    expect(screen.getByPlaceholderText('Commit message')).toHaveValue('');
  });
});
