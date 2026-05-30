import { NavLink, Outlet } from 'react-router';
import { cn } from '../../lib/utils';

const SUB_TABS: { to: string; label: string }[] = [
  { to: 'provider', label: 'Built-in' },
  { to: 'defaults', label: 'Defaults' },
];

export function SettingsSection() {
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1">
        {SUB_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'rounded-md border border-transparent px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-border bg-card text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
