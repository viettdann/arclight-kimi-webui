import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuthStore } from '../../lib/auth-store';
import { cn } from '../../lib/utils';

export interface SettingsNavItem {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
}

interface SettingsLayoutProps {
  /** Breadcrumb / page title shown in the topbar and nav eyebrow. */
  title: string;
  navItems: SettingsNavItem[];
  /** Optional chrome rendered between the nav and the routed panel (e.g. the
      per-section config header that Settings shows on editable routes). */
  contentHeader?: ReactNode;
}

/** Two-letter avatar initials from a display name or email local-part. */
function initials(name?: string, email?: string): string {
  const src = name?.trim() || email?.split('@')[0] || '';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return src.slice(0, 2).toUpperCase() || '?';
}

/**
 * Full-page chrome for Settings / Preferences. These pages live OUTSIDE the
 * chat Shell (no fixed project rail) — a slim topbar with a back-to-chat
 * button replaces it, mirroring docs/redesign/{settings,preferences}.html.
 * One sidebar, never two.
 */
export function SettingsLayout({ title, navItems, contentHeader }: SettingsLayoutProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Slim topbar — back to chat, breadcrumb, account avatar. */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back to chat"
          title="Back to chat"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        <span className="text-lg font-medium tracking-tight">{title}</span>
        <span className="flex-1" />
        {user && (
          <div
            title={user.email}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold tracking-wide text-primary-foreground shadow-sm"
          >
            {initials(user.name, user.email)}
          </div>
        )}
      </header>

      {/* Body — capped + centered: one sidebar nav + scrollable content. */}
      <div className="mx-auto flex w-full min-h-0 max-w-[1180px] flex-1 overflow-hidden">
        {/* Desktop sidebar nav */}
        <aside className="hidden w-[230px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex">
          <span className="px-2.5 pb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </span>
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ''}
                className={({ isActive }) =>
                  cn(
                    'nav-accent flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'active bg-primary-wash font-semibold text-primary-hover'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                  )
                }
              >
                <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Account badge pinned to the bottom of the nav. */}
          {user && (
            <div className="mt-auto pt-4">
              <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Your account
                </span>
                <span className="break-all font-mono text-xs text-foreground">{user.email}</span>
              </div>
            </div>
          )}
        </aside>

        {/* Content column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Mobile horizontal nav (no rail on small screens). */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-sidebar px-3 py-2 md:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ''}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
                    isActive
                      ? 'bg-primary-wash font-semibold text-primary-hover'
                      : 'text-muted-foreground hover:bg-sidebar-accent/60',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          {contentHeader}

          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-11">
            <div className="mx-auto w-full max-w-[820px]">
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
