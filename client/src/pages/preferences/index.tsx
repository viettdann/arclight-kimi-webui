import { NavLink, Outlet, useLocation } from 'react-router';
import { cn } from '../../lib/utils';

interface NavItem {
  to: string;
  label: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: 'git-credentials',
    label: 'Git credentials',
    description: 'Tokens for cloning repos',
  },
];

export function PreferencesView() {
  // useLocation keeps active-state derivation consistent with SettingsView,
  // even though NavLink handles styling itself.
  useLocation();

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Vertical nav (desktop) */}
      <aside className="hidden md:flex w-[220px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-3 py-4">
        <h1 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Preferences
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

        {/* Active panel */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
