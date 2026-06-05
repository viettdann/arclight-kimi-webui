import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeGitCommand = vi.fn();
const fetchGitStatus = vi.fn();
const fetchGitBranches = vi.fn();
const fetchGitLog = vi.fn();

vi.mock('@/api/git', () => ({
  executeGitCommand: (...args: unknown[]) => executeGitCommand(...args),
  fetchGitStatus: (...args: unknown[]) => fetchGitStatus(...args),
  fetchGitBranches: (...args: unknown[]) => fetchGitBranches(...args),
  fetchGitLog: (...args: unknown[]) => fetchGitLog(...args),
  fetchProjectGitMetadata: vi.fn().mockResolvedValue(null),
  linkGitCredential: vi.fn().mockResolvedValue(undefined),
  commitGit: vi.fn(),
  NotGitRepoError: class NotGitRepoError extends Error {},
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useGitPanelStore } from '@/lib/git-panel-store';

const ok = { exitCode: 0, stdout: '', stderr: '' };

beforeEach(() => {
  vi.clearAllMocks();
  fetchGitStatus.mockResolvedValue({ entries: [], ahead: 0, behind: 0 });
  fetchGitBranches.mockResolvedValue({ branches: [], current: 'main' });
  fetchGitLog.mockResolvedValue({ commits: [] });
  useGitPanelStore.setState({
    projectName: 'proj',
    status: 'ready',
    isBusy: false,
    autoFetchDisabled: false,
    statusData: null,
    branchData: null,
    logData: null,
  });
});

describe('useGitPanelStore.autoFetch', () => {
  it('fetches silently and refreshes status/branches/log on success', async () => {
    executeGitCommand.mockResolvedValue(ok);
    await useGitPanelStore.getState().autoFetch();

    expect(executeGitCommand).toHaveBeenCalledWith({
      projectName: 'proj',
      command: 'fetch',
      args: [],
    });
    expect(fetchGitStatus).toHaveBeenCalledWith('proj');
    expect(fetchGitBranches).toHaveBeenCalledWith('proj');
    expect(fetchGitLog).toHaveBeenCalledWith('proj');
    expect(useGitPanelStore.getState().autoFetchDisabled).toBe(false);
  });

  it('backs off on non-zero exit without refreshing', async () => {
    executeGitCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' });
    await useGitPanelStore.getState().autoFetch();

    expect(useGitPanelStore.getState().autoFetchDisabled).toBe(true);
    expect(fetchGitStatus).not.toHaveBeenCalled();
  });

  it('backs off when fetch needs auth even with exit 0 payload', async () => {
    executeGitCommand.mockResolvedValue({ ...ok, requiresAuth: true });
    await useGitPanelStore.getState().autoFetch();

    expect(useGitPanelStore.getState().autoFetchDisabled).toBe(true);
  });

  it('backs off on network failure', async () => {
    executeGitCommand.mockRejectedValue(new Error('offline'));
    await useGitPanelStore.getState().autoFetch();

    expect(useGitPanelStore.getState().autoFetchDisabled).toBe(true);
  });

  it('skips entirely while backed off', async () => {
    useGitPanelStore.setState({ autoFetchDisabled: true });
    await useGitPanelStore.getState().autoFetch();

    expect(executeGitCommand).not.toHaveBeenCalled();
  });

  it('skips while a user command is running', async () => {
    useGitPanelStore.setState({ isBusy: true });
    await useGitPanelStore.getState().autoFetch();

    expect(executeGitCommand).not.toHaveBeenCalled();
  });

  it('skips non-repos and missing project', async () => {
    useGitPanelStore.setState({ status: 'not_git_repo' });
    await useGitPanelStore.getState().autoFetch();
    useGitPanelStore.setState({ status: 'ready', projectName: null });
    await useGitPanelStore.getState().autoFetch();

    expect(executeGitCommand).not.toHaveBeenCalled();
  });
});

describe('auto-fetch backoff recovery', () => {
  it('a successful manual remote command lifts the backoff', async () => {
    useGitPanelStore.setState({ autoFetchDisabled: true });
    executeGitCommand.mockResolvedValue(ok);

    await useGitPanelStore.getState().executeCommand('fetch');

    expect(useGitPanelStore.getState().autoFetchDisabled).toBe(false);
  });

  it('a successful local command does not touch the backoff', async () => {
    useGitPanelStore.setState({ autoFetchDisabled: true });
    executeGitCommand.mockResolvedValue(ok);

    await useGitPanelStore.getState().executeCommand('checkout', ['main']);

    expect(useGitPanelStore.getState().autoFetchDisabled).toBe(true);
  });
});
