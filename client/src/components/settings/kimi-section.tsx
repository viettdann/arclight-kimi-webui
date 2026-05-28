import { NavLink, Outlet } from 'react-router';
import { cn } from '../../lib/utils';

const SUB_TABS: { to: string; label: string }[] = [
  { to: 'defaults', label: 'Defaults' },
  { to: 'services', label: 'Services' },
  { to: 'agent', label: 'Agent loop' },
  { to: 'background', label: 'Background' },
  { to: 'hooks', label: 'Hooks' },
  { to: 'raw-toml', label: 'Raw TOML' },
];

export function KimiSection() {
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/30 p-1">
        {SUB_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'rounded px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
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
