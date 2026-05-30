import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { showToast } from '../../components/toast-provider';
import { useConfigStore } from '../../lib/config-store';
import { cn } from '../../lib/utils';

interface NavItem {
  to: string;
  label: string;
  description: string;
  end?: boolean;
  /** Hide top-level Save/Discard buttons (for non-config sub-routes). */
  hideEditChrome?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: 'overview',
    label: 'Overview',
    description: 'System info & status',
    hideEditChrome: true,
  },
  { to: 'claude', label: 'Claude', description: 'Provider, models & defaults' },
  {
    to: 'access',
    label: 'Members & access',
    description: 'Identity & allowlist',
    hideEditChrome: true,
  },
];

export function SettingsView() {
  const loadStatus = useConfigStore((s) => s.loadStatus);
  const loadError = useConfigStore((s) => s.loadError);
  const dirty = useConfigStore((s) => s.dirty);
  const saving = useConfigStore((s) => s.saving);
  const load = useConfigStore((s) => s.load);
  const save = useConfigStore((s) => s.save);
  const discard = useConfigStore((s) => s.discard);

  const { pathname } = useLocation();
  const activeNav = NAV_ITEMS.find((item) => pathname.startsWith(`/settings/${item.to}`));
  const showEditChrome = activeNav?.hideEditChrome !== true;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    if (loadStatus === 'idle' || loadStatus === 'error') {
      void load();
    }
  }, []);

  // Surface load errors via toast (banner was removed).
  useEffect(() => {
    if (loadStatus === 'error' && loadError) {
      showToast({ message: `Failed to load configuration: ${loadError}`, type: 'error' });
    }
  }, [loadStatus, loadError]);

  async function handleSave() {
    const res = await save();
    showToast(
      res.ok
        ? { message: 'Configuration saved', type: 'info' }
        : { message: res.error ?? 'Save failed', type: 'error' },
    );
  }

  async function handleDiscard() {
    await discard();
    showToast({ message: 'Discarded local changes', type: 'info' });
  }

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

        {/* Sticky header with actions (hidden on routes that don't edit config) */}
        {showEditChrome && (
          <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6 py-3 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Configuration</h2>
              <p className="text-xs text-muted-foreground">
                Changes are kept locally until you press Save.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDiscard()}
                  disabled={saving}
                >
                  Discard
                </Button>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </header>
        )}

        {/* Active panel */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
          {loadStatus === 'loading' || loadStatus === 'idle' ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </div>
    </div>
  );
}
