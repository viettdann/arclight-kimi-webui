import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useBlocker, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '../../lib/auth-store';
import { cn } from '../../lib/utils';
import {
  SettingsDirtyContext,
  useSettingsDirty,
  useSettingsDirtyState,
} from './use-settings-dirty';

export interface SettingsNavItem {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
}

interface SettingsDialogProps {
  /** Breadcrumb / eyebrow shown above the nav. */
  title: string;
  navItems: SettingsNavItem[];
}

/**
 * Settings rendered as a route-driven modal overlay. The route only ever
 * renders this on `/settings/*`, so the dialog is always open while mounted;
 * dismissal navigates back rather than flipping an `open` flag. A dirty
 * registry (provided here) feeds the close lock so unsaved work can't be lost.
 */
export function SettingsDialog({ title, navItems }: SettingsDialogProps) {
  const dirty = useSettingsDirtyState();
  return (
    <SettingsDirtyContext.Provider value={dirty}>
      <SettingsDialogInner title={title} navItems={navItems} />
    </SettingsDirtyContext.Provider>
  );
}

function SettingsDialogInner({ title, navItems }: SettingsDialogProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isDirty = useSettingsDirty()?.isDirty ?? false;

  // Where to return on close. Captured once: opening from the app stamps the
  // origin into history state; internal section nav drops it, but the dialog
  // stays mounted so this initial read survives. Cold deep-links (no state)
  // close to `/`.
  const [background] = useState<string>(() => {
    const bg = (location.state as { backgroundLocation?: string } | null)?.backgroundLocation;
    return typeof bg === 'string' ? bg : '/';
  });

  // Block navigations that LEAVE settings while dirty (close / browser back),
  // not section switches within the modal.
  const blocker = useBlocker(
    useCallback(
      ({ nextLocation }: { nextLocation: { pathname: string } }) => {
        const { pathname } = nextLocation;
        // Boundary match, not bare prefix: a sibling like `/settings-export`
        // must count as leaving, not as an internal section switch.
        const insideSettings = pathname === '/settings' || pathname.startsWith('/settings/');
        return isDirty && !insideSettings;
      },
      [isDirty],
    ),
  );

  // Guard the F5 / tab-close path that `useBlocker` cannot intercept.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const close = useCallback(() => navigate(background), [navigate, background]);

  return (
    <Dialog
      open
      modal
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPortal>
        {/* Settings-only overlay: blur the static backdrop without touching the
            shared DialogOverlay used by every other dialog. */}
        <DialogOverlay className="backdrop-blur-sm" />
        <DialogPrimitive.Popup
          data-slot="settings-dialog"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex h-[85dvh] w-full max-w-6xl -translate-x-1/2 -translate-y-1/2',
            'overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg outline-none',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            // Mobile: full-screen, no chrome.
            'max-md:h-dvh max-md:max-w-none max-md:rounded-none max-md:border-0',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>

          {/* Desktop sidebar nav. */}
          <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex">
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

          {/* Content column. */}
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

            <div className="flex-1 overflow-y-auto px-4 py-8 md:px-11">
              <div className="mx-auto w-full max-w-4xl">
                <Outlet />
              </div>
            </div>
          </div>

          {/* Close — fires onOpenChange(false) → navigate back (blocked when dirty). */}
          <DialogPrimitive.Close
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close settings</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPortal>

      {/* Discard / Keep confirm — shown while a dirty close is blocked. */}
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent showCloseButton={false} className="gap-4">
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            You have changes that haven't been saved. Leaving now will discard them.
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
