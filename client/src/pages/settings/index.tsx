import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { useKimiConfigStore } from '../../lib/kimi-config-store';
import { cn } from '../../lib/utils';
import { showToast } from '../../components/toast-provider';

interface NavItem {
  to: string;
  label: string;
  description: string;
  end?: boolean;
  /** Hide top-level Save/Discard/Test buttons (for non-kimi-config sub-routes). */
  hideEditChrome?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: 'provider', label: 'Provider', description: 'API credentials & models' },
  { to: 'kimi', label: 'Kimi config', description: 'CLI behavior & integrations' },
  { to: 'account', label: 'Account', description: 'Your signed-in identity', hideEditChrome: true },
  {
    to: 'access',
    label: 'Access control',
    description: 'Allowlist enforcement',
    hideEditChrome: true,
  },
];

export function SettingsView() {
  const loadStatus = useKimiConfigStore((s) => s.loadStatus);
  const loadError = useKimiConfigStore((s) => s.loadError);
  const dirty = useKimiConfigStore((s) => s.dirty);
  const saving = useKimiConfigStore((s) => s.saving);
  const testing = useKimiConfigStore((s) => s.testing);
  const testResult = useKimiConfigStore((s) => s.testResult);
  const status = useKimiConfigStore((s) => s.status);
  const load = useKimiConfigStore((s) => s.load);
  const save = useKimiConfigStore((s) => s.save);
  const discard = useKimiConfigStore((s) => s.discard);
  const test = useKimiConfigStore((s) => s.test);

  const { pathname } = useLocation();
  // Hide Test/Discard/Save chrome on routes that don't mutate kimi-config
  // (Account, Access control). Match the active NavItem by URL prefix.
  const activeNav = NAV_ITEMS.find((item) => pathname.startsWith(`/settings/${item.to}`));
  const showEditChrome = activeNav?.hideEditChrome !== true;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    if (loadStatus === 'idle' || loadStatus === 'error') {
      void load();
    }
  }, []);

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
            <span className="block text-xs text-muted-foreground mt-0.5">
              {item.description}
            </span>
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

        {/* Sticky header with actions (hidden on routes that don't edit kimi-config) */}
        {showEditChrome && (
          <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6 py-3 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Configuration</h2>
              <p className="text-xs text-muted-foreground">
                Changes are kept locally until you press Save.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void test()}
                disabled={testing}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
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

        {/* Status banner */}
        <div className="px-4 md:px-6 pt-4 space-y-2 shrink-0">
          {loadStatus === 'error' && (
            <Banner tone="error">
              Failed to load configuration: {loadError ?? 'unknown error'}.{' '}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => void load()}
              >
                Retry
              </button>
            </Banner>
          )}
          {status && (
            <Banner tone={status.ready ? 'success' : 'warning'}>
              <strong className="font-semibold">
                {status.ready ? 'Configuration ready' : 'Configuration incomplete'}.
              </strong>{' '}
              Auth mode: <code className="font-mono">{status.authMode}</code>
              {status.missing.length > 0 && <> · Missing: {status.missing.join(', ')}</>}
            </Banner>
          )}
          {testResult && (
            <Banner tone={testResult.ok ? 'success' : 'error'}>
              {testResult.ok
                ? 'Test connection succeeded.'
                : `Test connection failed: ${testResult.error}`}
            </Banner>
          )}
        </div>

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

function Banner({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'error' | 'info';
  children: React.ReactNode;
}) {
  const toneClass: Record<typeof tone, string> = {
    success:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    error: 'border-destructive/40 bg-destructive/10 text-destructive',
    info: 'border-border bg-muted/40 text-foreground',
  };
  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm', toneClass[tone])}>
      {children}
    </div>
  );
}
