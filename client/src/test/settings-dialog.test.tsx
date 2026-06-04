import { cleanup, render, screen } from '@testing-library/react';
import { CogIcon, SettingsIcon, UserIcon } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Hoisted mocks ------------------------------------------------------------
const { navigate, useAuthStore } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAuthStore: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({
    pathname: '/settings/general',
    search: '',
    hash: '',
    state: null,
    key: 'default',
  }),
  useBlocker: () => ({ state: 'unblocked', reset: vi.fn(), proceed: vi.fn() }),
  // NavLink renders as a plain <a> with active class logic.
  NavLink: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string | ((params: { isActive: boolean }) => string);
  }) => {
    // Simulate active matching: current pathname starts with `to`.
    const isActive = to === '/settings/general';
    const cls = typeof className === 'function' ? className({ isActive }) : className;
    return (
      <a href={to} className={cls}>
        {children}
      </a>
    );
  },
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock('@/lib/auth-store', () => ({ useAuthStore }));

// -- Import after mocks -------------------------------------------------------

import { SettingsDialog, type SettingsNavItem } from '@/components/settings/settings-dialog';

// -- Helpers ------------------------------------------------------------------

const navItems: SettingsNavItem[] = [
  {
    to: '/settings/general',
    label: 'General',
    description: 'General settings',
    icon: <SettingsIcon />,
  },
  {
    to: '/settings/account',
    label: 'Account',
    description: 'Account settings',
    icon: <UserIcon />,
  },
];

const adminNavItem: SettingsNavItem = {
  to: '/settings/system',
  label: 'System',
  description: 'System administration',
  icon: <CogIcon />,
};

function renderDialog(items: SettingsNavItem[] = navItems) {
  return render(<SettingsDialog title="Settings" navItems={items} />);
}

function mockUser(email: string, role: string) {
  useAuthStore.mockImplementation(
    (sel: (s: { user: { email: string; role: string } | null }) => unknown) =>
      sel({ user: { email, role } }),
  );
}

function mockNoUser() {
  useAuthStore.mockImplementation((sel: (s: { user: null }) => unknown) => sel({ user: null }));
}

afterEach(cleanup);

// -- Tests --------------------------------------------------------------------

describe('SettingsDialog', () => {
  beforeEach(() => {
    navigate.mockReset();
    mockUser('user@test.com', 'user');
  });

  it('renders with "Settings" heading', () => {
    renderDialog();
    // The sidebar renders the title as an uppercase eyebrow.
    const headings = screen.getAllByText('Settings');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a close button', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /close settings/i })).toBeInTheDocument();
  });

  it('renders navigation items from props', () => {
    renderDialog();
    // Each nav item label appears in both desktop sidebar and mobile nav.
    expect(screen.getAllByText('General').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Account').length).toBeGreaterThanOrEqual(1);
  });

  it('renders System nav item when passed (admin scenario)', () => {
    mockUser('admin@test.com', 'admin');
    renderDialog([...navItems, adminNavItem]);
    expect(screen.getAllByText('System').length).toBeGreaterThanOrEqual(1);
    // User account card shows the admin email.
    expect(screen.getByText('admin@test.com')).toBeInTheDocument();
  });

  it('shows the logged-in user email in the sidebar', () => {
    renderDialog();
    expect(screen.getByText('user@test.com')).toBeInTheDocument();
  });

  it('hides the user account card when user is null', () => {
    mockNoUser();
    renderDialog();
    expect(screen.queryByText('Your account')).not.toBeInTheDocument();
  });

  it('nav links point to the correct routes', () => {
    renderDialog();
    const generalLinks = screen.getAllByRole('link', { name: /general/i });
    const hrefs = generalLinks.map((el) => el.getAttribute('href'));
    expect(hrefs).toContain('/settings/general');

    const accountLinks = screen.getAllByRole('link', { name: /account/i });
    const accountHrefs = accountLinks.map((el) => el.getAttribute('href'));
    expect(accountHrefs).toContain('/settings/account');
  });

  it('marks the active nav item with an "active" class', () => {
    renderDialog();
    // The mocked NavLink marks /settings/general as active.
    const generalLinks = screen.getAllByRole('link', { name: /general/i });
    const activeLink = generalLinks.find((el) => el.classList.contains('active'));
    expect(activeLink).toBeTruthy();

    // Account links should NOT have the active class.
    const accountLinks = screen.getAllByRole('link', { name: /account/i });
    const activeAccount = accountLinks.find((el) => el.classList.contains('active'));
    expect(activeAccount).toBeUndefined();
  });
});
