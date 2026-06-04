import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GitCredentialDTO, ProjectCreateRequest, ProjectCreateResponse } from 'shared/types';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// The embedded "add credential" dialog pulls in its own network layer; stub it.
vi.mock('@/components/preferences/git-credential-dialog', () => ({
  GitCredentialDialog: () => null,
}));

import { NewProjectModal } from '@/components/new-project-modal';
import { useCloneProgressStore } from '@/lib/clone-progress-store';
import { useGitCredentialsStore } from '@/lib/git-credentials-store';
import { useProjectsStore } from '@/lib/projects-store';

const credential: GitCredentialDTO = {
  id: 'cred-1',
  label: 'GitHub PAT',
  provider: 'github',
  tokenMask: '***abcd',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

type CreateFn = (opts: {
  name?: string;
  source?: ProjectCreateRequest['source'];
}) => Promise<ProjectCreateResponse>;
let create: Mock<CreateFn>;
let cancelClone: Mock<(name: string) => Promise<void>>;

beforeEach(() => {
  create = vi.fn<CreateFn>();
  cancelClone = vi.fn<(name: string) => Promise<void>>();
  // Real stores, swapped actions: the async network calls become controllable.
  useProjectsStore.setState({ create, cancelClone });
  useGitCredentialsStore.setState({
    credentials: [credential],
    status: 'ready',
    ensureLoaded: vi.fn(),
  });
  useCloneProgressStore.setState({ byId: {} });
});
afterEach(cleanup);

describe('NewProjectModal — blank mode', () => {
  it('rejects an empty name without calling create', async () => {
    const user = userEvent.setup();
    render(<NewProjectModal isOpen onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Name must be 1-60 characters')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a blank project with the trimmed name and closes', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ name: 'my-app', workDir: '/w', origin: 'local' });
    const onClose = vi.fn();
    render(<NewProjectModal isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText('Project name'), '  my-app  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(create).toHaveBeenCalledWith({ name: 'my-app' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a create failure and stays open', async () => {
    const user = userEvent.setup();
    create.mockRejectedValue(new Error('disk full'));
    const onClose = vi.fn();
    render(<NewProjectModal isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText('Project name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('disk full')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('NewProjectModal — clone mode', () => {
  it('validates the URL and credential before cloning', async () => {
    const user = userEvent.setup();
    render(<NewProjectModal isOpen onClose={() => {}} />);

    await user.click(screen.getByRole('radio', { name: /Clone/ }));

    // No URL yet.
    await user.click(screen.getByRole('button', { name: 'Clone' }));
    expect(screen.getByText('Repository URL is required')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    // URL but no credential selected.
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/o/r.git');
    await user.click(screen.getByRole('button', { name: 'Clone' }));
    expect(screen.getByText('Select or add a git credential')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('hands off to the live progress view when the clone starts', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({
      name: 'r',
      workDir: '/w/r',
      origin: 'local',
      status: 'cloning',
      cloneId: 'clone-9',
    });
    render(<NewProjectModal isOpen onClose={() => {}} />);

    await user.click(screen.getByRole('radio', { name: /Clone/ }));
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/o/r.git');
    await user.selectOptions(screen.getByLabelText('Credential'), 'cred-1');
    await user.click(screen.getByRole('button', { name: 'Clone' }));

    expect(create).toHaveBeenCalledWith({
      name: undefined,
      source: { type: 'clone', url: 'https://github.com/o/r.git', credentialId: 'cred-1' },
    });
    // Progress view replaces the form.
    expect(await screen.findByRole('button', { name: 'Run in background' })).toBeInTheDocument();
    expect(useCloneProgressStore.getState().byId['clone-9']?.status).toBe('cloning');
  });
});
