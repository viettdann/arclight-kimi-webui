import { NavLink, Outlet, useLocation } from 'react-router';
import { cn } from '../../lib/utils';

interface NavItem {
  to: string;
  label: string;
  description: string;
  /** Hide the config header (for non-config sub-routes). */
  hideEditChrome?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: 'overview',
    label: 'Overview',
    description: 'System info & status',
    hideEditChrome: true,
  },
  { to: 'claude', label: 'Claude', description: 'Providers & defaults' },
  {
    to: 'access',
    label: 'Members & access',
    description: 'Identity & allowlist',
    hideEditChrome: true,
  },
];

export function SettingsView() {
  const { pathname } = useLocation();
  const activeNav = NAV_ITEMS.find((item) => pathname.startsWith(`/settings/${item.to}`));
  const showEditChrome = activeNav?.hideEditChrome !== true;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Vertical nav (desktop) / horizontal scroll (mobile) */}
      <aside className="hidden md:flex w-[220px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-3 py-4">
        <h1 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Settings
        </h1>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )
            }
          >
            <span className="block">{item.label}</span>
            <span className="block text-xs text-muted-foreground mt-0.5">{item.description}</span>
          </NavLink>
        ))}
      </aside>

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile horizontal nav */}
        <nav className="md:hidden flex gap-1 overflow-x-auto border-b border-border bg-sidebar px-3 py-2 shrink-0">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-xs whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Config header (hidden on routes that don't edit config). Each panel
            owns its own Save/Discard — there is no page-wide save. */}
        {showEditChrome && (
          <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6 py-3 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Configuration</h2>
              <p className="text-xs text-muted-foreground">
                Changes are staged per section until you press its Save button.
              </p>
            </div>
          </header>
        )}

        {/* Active panel */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
