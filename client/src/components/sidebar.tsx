import { LogOut, Plus, SquarePen, Zap } from 'lucide-react';
import { useAuthStore } from '../lib/auth-store';

interface SidebarProps {
  onLoginClick: () => void;
}

function AuthSection({ onLoginClick }: { onLoginClick: () => void }) {
  const { status, user, clearSession } = useAuthStore((s) => ({
    status: s.status,
    user: s.user,
    clearSession: s.clearSession,
  }));

  if (status === 'unknown') {
    return (
      <div className="space-y-3 px-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="px-3">
        <button
          type="button"
          onClick={onLoginClick}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          Log in
        </button>
      </div>
    );
  }

  const initials =
    user?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? 'U';

  return (
    <div className="px-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => clearSession('manual')}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ onLoginClick }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 flex h-screen w-64 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
          M
        </div>
        <span className="text-sm font-semibold">More Than Coding</span>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        <button
          type="button"
          className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <span className="flex items-center gap-2">
            <SquarePen className="h-4 w-4" />
            New task
          </span>
          <kbd className="rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground">
            ⌘N
          </kbd>
        </button>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Zap className="h-4 w-4" />
          Skills
        </button>
      </nav>

      {/* Project list */}
      <div className="flex flex-1 flex-col px-3 py-2">
        <div className="mb-2 flex items-center justify-between px-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Project list
          </span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors"
            aria-label="Add project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="rounded-full bg-muted p-3">
            <Plus className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No projects yet</p>
        </div>
      </div>

      {/* Auth section */}
      <div className="border-t border-sidebar-border py-3">
        <AuthSection onLoginClick={onLoginClick} />
      </div>
    </aside>
  );
}
