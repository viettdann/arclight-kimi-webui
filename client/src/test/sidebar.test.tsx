import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock fns — referenced inside vi.mock factories before imports
// ---------------------------------------------------------------------------
const { navigate, onLoginClick, onClose, launchNewTask, openNewProject, clearSession } = vi.hoisted(
  () => ({
    navigate: vi.fn(),
    onLoginClick: vi.fn(),
    onClose: vi.fn(),
    launchNewTask: vi.fn(),
    openNewProject: vi.fn(),
    clearSession: vi.fn(),
  }),
);

// Mutable state holders — setState mutates these in place so the selector
// closures always read the current values without stale-reference issues.
const { authHolder, projectsHolder, sessionsHolder, sidebarHolder } = vi.hoisted(() => ({
  authHolder: {
    status: 'unauthenticated' as string,
    user: null as Record<string, unknown> | null,
    allowed: null as boolean | null,
    lastClearReason: null as string | null,
    clearSession,
  },
  projectsHolder: {
    projects: [] as Record<string, unknown>[],
    status: 'idle' as string,
    error: null as string | null,
    expanded: {} as Record<string, boolean>,
    fetch: vi.fn(),
    expand: vi.fn(),
  },
  sessionsHolder: {
    sessions: [] as Record<string, unknown>[],
    status: 'idle' as string,
    error: null as string | null,
    fetch: vi.fn(),
  },
  sidebarHolder: {
    filesOpen: false,
    filesProjectName: null as string | null,
  },
}));

// ---------------------------------------------------------------------------
// Mock all external dependencies
// ---------------------------------------------------------------------------
vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: undefined }),
  useLocation: () => ({ pathname: '/', search: '' }),
}));

// Real router.tsx builds a browser router on import; stub it to avoid createBrowserRouter.
vi.mock('@/lib/router', () => ({ DRAFT_WORKDIR_PARAM: 'workDir' }));

vi.mock('../lib/ws-client', () => ({
  wsClient: {
    on: vi.fn(() => vi.fn()),
    close: vi.fn(),
  },
}));

vi.mock('../lib/auth-store', () => ({
  useAuthStore: Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(authHolder), {
    getState: () => authHolder,
    setState: (patch: Partial<typeof authHolder>) => Object.assign(authHolder, patch),
  }),
}));

vi.mock('../lib/projects-store', () => ({
  useProjectsStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(projectsHolder),
    {
      getState: () => projectsHolder,
      setState: (patch: Partial<typeof projectsHolder>) => Object.assign(projectsHolder, patch),
    },
  ),
}));

vi.mock('../lib/sessions-store', () => ({
  useSessionsStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(sessionsHolder),
    {
      getState: () => sessionsHolder,
      setState: (patch: Partial<typeof sessionsHolder>) => Object.assign(sessionsHolder, patch),
    },
  ),
  groupByProject: (sessions: unknown[]) => {
    const groups: Record<string, unknown[]> = {};
    for (const s of sessions as { projectName: string }[]) {
      if (!groups[s.projectName]) groups[s.projectName] = [];
      groups[s.projectName]!.push(s);
    }
    return groups;
  },
}));

vi.mock('../lib/sidebar-view-store', () => ({
  useSidebarViewStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(sidebarHolder),
    {
      getState: () => sidebarHolder,
      setState: (patch: Partial<typeof sidebarHolder>) => Object.assign(sidebarHolder, patch),
    },
  ),
}));

vi.mock('../lib/project-launch-store', () => ({
  useProjectLaunchStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({ launch: launchNewTask, openNewProject }),
    {
      getState: () => ({ launch: launchNewTask, openNewProject }),
      setState: vi.fn(),
    },
  ),
}));

vi.mock('@/components/file-management-view', () => ({
  FileManagementView: () => <div data-testid="file-management-view" />,
}));

vi.mock('@/components/project-row', () => ({
  ProjectRow: ({ project }: { project: { name: string } }) => (
    <div data-testid={`project-row-${project.name}`}>{project.name}</div>
  ),
  CloningProjectRow: ({ name }: { name: string }) => (
    <div data-testid={`cloning-row-${name}`}>{name}</div>
  ),
}));

vi.mock('@/components/skills-modal', () => ({
  SkillsModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="skills-modal" /> : null,
}));

vi.mock('@/components/toast-provider', () => ({
  showToast: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER mocks are registered
// ---------------------------------------------------------------------------
import { Sidebar } from '../components/sidebar';
import { useAuthStore } from '../lib/auth-store';
import { useProjectsStore } from '../lib/projects-store';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetStores() {
  useAuthStore.setState({
    status: 'unauthenticated',
    user: null,
    allowed: null,
    lastClearReason: null,
    clearSession,
  });
  useProjectsStore.setState({
    projects: [],
    status: 'idle',
    error: null,
    expanded: {},
    fetch: vi.fn(),
    expand: vi.fn(),
  });
}

function renderSidebar(overrides: { isOpen?: boolean } = {}) {
  return render(
    <Sidebar isOpen={overrides.isOpen ?? true} onClose={onClose} onLoginClick={onLoginClick} />,
  );
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Sidebar — unauthenticated state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it('shows "Log in" button', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows login prompt text when there are no projects', () => {
    renderSidebar();
    expect(screen.getByText('Log in to create projects and start tasks.')).toBeInTheDocument();
  });

  it('does not show "New project" button', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /New project/i })).not.toBeInTheDocument();
  });

  it('clicking "New task" triggers onLoginClick', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: /New task/i }));
    expect(onLoginClick).toHaveBeenCalledTimes(1);
    expect(launchNewTask).not.toHaveBeenCalled();
  });

  it('clicking "Log in" triggers onLoginClick', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(onLoginClick).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar — authenticated state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'alice@example.com',
        name: 'Alice Example',
        role: 'user',
      },
      allowed: true,
      lastClearReason: null,
      clearSession,
    });
  });

  it('shows user menu button with the user name', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument();
    expect(screen.getByText('Alice Example')).toBeInTheDocument();
  });

  it('shows user email', () => {
    renderSidebar();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('shows "New task" button', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /New task/i })).toBeInTheDocument();
  });

  it('shows "New project" button', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /New project/i })).toBeInTheDocument();
  });

  it('does not show "Log in" button', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('shows initials avatar derived from user name', () => {
    renderSidebar();
    // "Alice Example" -> initials "AE"
    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('clicking "New task" triggers launchNewTask', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: /New task/i }));
    expect(launchNewTask).toHaveBeenCalledTimes(1);
    expect(onLoginClick).not.toHaveBeenCalled();
  });

  it('clicking "New project" triggers openNewProject', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: /New project/i }));
    expect(openNewProject).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar — admin user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'admin@example.com',
        name: 'Admin User',
        role: 'admin',
      },
      allowed: true,
      lastClearReason: null,
      clearSession,
    });
  });

  it('shows "Admin" badge next to the user name', () => {
    renderSidebar();
    // The badge appears twice: in the trigger button and inside the dropdown header.
    const badges = screen.getAllByText('Admin');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Sidebar — user menu dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'bob@example.com',
        name: 'Bob',
        role: 'user',
      },
      allowed: true,
      lastClearReason: null,
      clearSession,
    });
  });

  it('contains Settings and Log out items', async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Open the dropdown
    await user.click(screen.getByRole('button', { name: 'User menu' }));

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  it('clicking "Log out" calls clearSession with "manual"', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(screen.getByText('Log out'));

    expect(clearSession).toHaveBeenCalledWith('manual');
  });
});

describe('Sidebar — projects section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'carol@example.com',
        name: 'Carol',
        role: 'user',
      },
      allowed: true,
      lastClearReason: null,
      clearSession,
    });
  });

  it('shows loading skeleton when projects are loading', () => {
    useProjectsStore.setState({
      projects: [],
      status: 'loading',
      error: null,
      expanded: {},
      fetch: vi.fn(),
      expand: vi.fn(),
    });
    renderSidebar();

    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No projects yet/i)).not.toBeInTheDocument();
  });

  it('shows error state with retry button when fetch fails', () => {
    const fetchProjects = vi.fn();
    useProjectsStore.setState({
      projects: [],
      status: 'error',
      error: 'http_500',
      expanded: {},
      fetch: fetchProjects,
      expand: vi.fn(),
    });
    renderSidebar();

    expect(screen.getByText('Failed to load projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows empty state when authenticated with no projects', () => {
    useProjectsStore.setState({
      projects: [],
      status: 'ready',
      error: null,
      expanded: {},
      fetch: vi.fn(),
      expand: vi.fn(),
    });
    renderSidebar();

    expect(screen.getByText('No projects yet — create your first one above.')).toBeInTheDocument();
  });

  it('renders local project rows', () => {
    useProjectsStore.setState({
      projects: [
        { name: 'proj-a', workDir: '/workspace/user/proj-a', origin: 'local', status: 'ready' },
        { name: 'proj-b', workDir: '/workspace/user/proj-b', origin: 'local', status: 'ready' },
      ],
      status: 'ready',
      error: null,
      expanded: {},
      fetch: vi.fn(),
      expand: vi.fn(),
    });
    renderSidebar();

    expect(screen.getByTestId('project-row-proj-a')).toBeInTheDocument();
    expect(screen.getByTestId('project-row-proj-b')).toBeInTheDocument();
  });

  it('renders foreign projects under "To restore" section', () => {
    useProjectsStore.setState({
      projects: [
        {
          name: 'local-proj',
          workDir: '/workspace/user/local-proj',
          origin: 'local',
          status: 'ready',
        },
        {
          name: 'foreign-proj',
          workDir: '/workspace/user/foreign-proj',
          origin: 'foreign',
          status: 'ready',
        },
      ],
      status: 'ready',
      error: null,
      expanded: {},
      fetch: vi.fn(),
      expand: vi.fn(),
    });
    renderSidebar();

    expect(screen.getByTestId('project-row-local-proj')).toBeInTheDocument();
    expect(screen.getByTestId('project-row-foreign-proj')).toBeInTheDocument();
    expect(screen.getByText('To restore')).toBeInTheDocument();
  });

  it('renders cloning project row for cloning status', () => {
    useProjectsStore.setState({
      projects: [
        {
          name: 'cloning-proj',
          workDir: '/workspace/user/cloning-proj',
          origin: 'local',
          status: 'cloning',
        },
      ],
      status: 'ready',
      error: null,
      expanded: {},
      fetch: vi.fn(),
      expand: vi.fn(),
    });
    renderSidebar();

    expect(screen.getByTestId('cloning-row-cloning-proj')).toBeInTheDocument();
  });
});

describe('Sidebar — brand mark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it('has a home button that navigates to "/"', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const homeBtn = screen.getByRole('button', { name: 'Go to home' });
    expect(homeBtn).toBeInTheDocument();
    expect(screen.getByText('More Than Code')).toBeInTheDocument();

    await user.click(homeBtn);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Sidebar — mobile overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it('shows a close overlay when sidebar is open', () => {
    renderSidebar({ isOpen: true });
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument();
  });

  it('does not show a close overlay when sidebar is closed', () => {
    renderSidebar({ isOpen: false });
    expect(screen.queryByRole('button', { name: 'Close menu' })).not.toBeInTheDocument();
  });

  it('clicking the overlay calls onClose', async () => {
    const user = userEvent.setup();
    renderSidebar({ isOpen: true });

    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar — Skills button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
      },
      allowed: true,
      lastClearReason: null,
      clearSession,
    });
  });

  it('opens the skills modal on click', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.queryByTestId('skills-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Skills/i }));
    expect(screen.getByTestId('skills-modal')).toBeInTheDocument();
  });
});
