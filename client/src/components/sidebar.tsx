import {
  ChevronRight,
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Plus,
  Settings,
  SquarePen,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { WSMessageType } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu, DropdownSeparator } from '@/components/ui/dropdown-menu';
import { useAuthStore } from '../lib/auth-store';
import { useNewSessionStore } from '../lib/new-session-store';
import { useProjectsStore } from '../lib/projects-store';
import { groupByProject, useSessionsStore } from '../lib/sessions-store';
import { useSidebarViewStore } from '../lib/sidebar-view-store';
import { wsClient } from '../lib/ws-client';
import { FileManagementView } from './file-management-view';
import { NewProjectModal } from './new-project-modal';
import { ProjectPickerModal } from './project-picker-modal';
import { CloningProjectRow, ProjectRow } from './project-row';
import { SkillsModal } from './skills-modal';
import { showToast } from './toast-provider';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginClick: () => void;
}

function AuthSection({ onLoginClick, onClose }: { onLoginClick: () => void; onClose: () => void }) {
  const navigate = useNavigate();
  // Single-field selectors avoid re-renders on unrelated auth-store changes.
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.status === 'authenticated' && s.user?.role === 'admin');
  const clearSession = useAuthStore((s) => s.clearSession);

  const go = useCallback(
    (path: string) => {
      onClose?.();
      navigate(path);
    },
    [navigate, onClose],
  );

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
        <Button type="button" variant="outline" onClick={onLoginClick} className="w-full">
          Log in
        </Button>
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

  const avatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
      {initials}
    </span>
  );

  const roleBadge = isAdmin ? (
    <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Admin
    </span>
  ) : null;

  return (
    <div className="px-3">
      <DropdownMenu
        align="start"
        side="top"
        contentClassName="w-[var(--anchor-width)]"
        trigger={
          <Button
            type="button"
            variant="ghost"
            aria-label="User menu"
            className="h-auto w-full justify-start gap-2.5 px-2 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {avatar}
            <span className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{user?.name}</span>
                {roleBadge}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </span>
            <ChevronsUpDown className="shrink-0 text-muted-foreground" />
          </Button>
        }
      >
        {/* Header mirrors the trigger so the menu reads as the account it belongs to. */}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          {avatar}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{user?.name}</span>
              {roleBadge}
            </div>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <DropdownSeparator />
        <DropdownItem
          icon={<KeyRound />}
          trailing={<ChevronRight />}
          onClick={() => go('/preferences')}
        >
          Preferences
        </DropdownItem>
        {isAdmin && (
          <DropdownItem
            icon={<Settings />}
            trailing={<ChevronRight />}
            onClick={() => go('/settings')}
          >
            Admin settings
          </DropdownItem>
        )}
        <DropdownSeparator />
        <DropdownItem destructive icon={<LogOut />} onClick={() => clearSession('manual')}>
          Log out
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}

const REFRESH_TRIGGER_TYPES = new Set<WSMessageType>([
  'snapshot',
  'session_created',
  'title_update',
  'project_adopted',
]);
// Cheap pre-filter so the streaming hot path (text_delta, thinking_delta, …)
// avoids JSON.parse on every frame. We only parse when the raw frame contains
// at least one trigger-type literal.
const REFRESH_RAW_HINTS = [
  '"snapshot"',
  '"session_created"',
  '"title_update"',
  '"project_adopted"',
];

export function Sidebar({ isOpen, onClose, onLoginClick }: SidebarProps) {
  const { id: openSessionId } = useParams<{ id: string }>();
  const status = useAuthStore((s) => s.status);
  const projects = useProjectsStore((s) => s.projects);
  const projectsStatus = useProjectsStore((s) => s.status);
  const fetchProjects = useProjectsStore((s) => s.fetch);
  const sessions = useSessionsStore((s) => s.sessions);
  const fetchSessions = useSessionsStore((s) => s.fetch);
  const filesOpen = useSidebarViewStore((s) => s.filesOpen);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const activeProjectName = useMemo(() => {
    if (!openSessionId) return null;
    return sessions.find((s) => s.id === openSessionId)?.projectName ?? null;
  }, [openSessionId, sessions]);

  // `filesOpen` is intent only; the project shown is always the active one.
  // If the user navigates away (no active project), the files panel hides.
  const showFiles = filesOpen && activeProjectName !== null;

  // Initial load when authenticated.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void fetchProjects();
    void fetchSessions();
  }, [status, fetchProjects, fetchSessions]);

  // Window focus → refresh sessions list.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const onFocus = () => {
      void useSessionsStore.getState().fetch();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [status]);

  // WS message subscription → debounced sessions + projects refresh on
  // session-mutating events. Projects refresh only on events that can change the
  // project set (`session_created` may surface a project's first session,
  // `project_adopted` covers explicit whole-project adoption); `snapshot`/
  // `title_update` never change the project set.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let projectsDirty = false;
    const unsubscribe = wsClient.on('message', (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      if (!raw) return;
      // Hot-path pre-filter: skip JSON.parse for streaming frames that can't
      // possibly carry a refresh-trigger type.
      let hinted = false;
      for (const h of REFRESH_RAW_HINTS) {
        if (raw.includes(h)) {
          hinted = true;
          break;
        }
      }
      if (!hinted) return;
      let type: string | undefined;
      try {
        const parsed = JSON.parse(raw) as { type?: string };
        type = parsed.type;
      } catch {
        return;
      }
      if (!type || !REFRESH_TRIGGER_TYPES.has(type as WSMessageType)) return;
      if (type === 'session_created' || type === 'project_adopted') projectsDirty = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const refreshProjects = projectsDirty;
        projectsDirty = false;
        void useSessionsStore.getState().fetch();
        if (refreshProjects) void useProjectsStore.getState().fetch();
      }, 500);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [status]);

  const triggerNewTask = useCallback(() => {
    onClose?.(); // Đóng sidebar drawer
    // Creating a task creates/picks a project — both require an account.
    if (status !== 'authenticated') {
      onLoginClick();
      return;
    }
    const list = useProjectsStore.getState().projects;
    const locals = list.filter((p) => p.origin === 'local');
    const hasForeign = list.some((p) => p.origin === 'foreign');
    if (locals.length === 0) {
      setNewProjectOpen(true);
      showToast({
        message: hasForeign ? 'Adopt a session or create a new project' : 'Create a project first',
        type: 'info',
      });
      return;
    }
    if (locals.length === 1) {
      const only = locals[0];
      if (only) useNewSessionStore.getState().request(only);
      return;
    }
    setPickerOpen(true);
  }, [onClose, status, onLoginClick]);

  // Memoize so ProjectRow receives a stable bucket reference per project name
  // and bails out of unrelated re-renders (modal open/close, auth churn).
  const sessionsByProject = useMemo(() => groupByProject(sessions), [sessions]);

  // Partition projects by origin once per `projects` reference change. `.filter`
  // is order-preserving so server-side collator order is retained in each pass.
  const localProjects = useMemo(() => projects.filter((p) => p.origin === 'local'), [projects]);
  const foreignProjects = useMemo(() => projects.filter((p) => p.origin === 'foreign'), [projects]);

  return (
    <>
      <aside
        className={`fixed left-0 top-0 z-40 flex h-dvh w-[300px] flex-col border-r border-border bg-sidebar transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            M
          </div>
          <span className="text-sm font-semibold">More Than Code</span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            onClick={triggerNewTask}
            className="w-full justify-start gap-2 px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <SquarePen />
            New task
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onClose?.();
              if (status !== 'authenticated') {
                onLoginClick();
                return;
              }
              setSkillsOpen(true);
            }}
            className="w-full justify-start gap-2 px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Zap />
            Skills
          </Button>
        </nav>

        {showFiles && activeProjectName ? (
          <FileManagementView projectName={activeProjectName} />
        ) : (
          <div className="flex flex-1 flex-col px-3 py-2 min-h-0">
            <div className="mb-2 px-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Projects
              </span>
            </div>

            {/* Creating a project is the entry point for every other action, so the
                primary CTA stays pinned and full-width above the (scrollable) list.
                Hidden while logged out — there's no account to create against yet. */}
            {status === 'authenticated' && (
              <Button
                type="button"
                onClick={() => {
                  onClose?.();
                  setNewProjectOpen(true);
                }}
                className="mb-2 w-full gap-2"
              >
                <Plus />
                New project
              </Button>
            )}

            <div className="flex flex-1 flex-col overflow-y-auto">
              {projectsStatus === 'loading' ? (
                <div className="flex flex-col gap-2 px-3 py-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                </div>
              ) : projectsStatus === 'error' ? (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
                  <p className="text-sm text-muted-foreground">Failed to load projects</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      void fetchProjects();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : projects.length === 0 ? (
                <p className="px-3 py-1 text-sm text-muted-foreground">
                  {status === 'authenticated'
                    ? 'No projects yet — create your first one above.'
                    : 'Log in to create projects and start tasks.'}
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {localProjects.length === 0 && foreignProjects.length > 0 ? (
                    <p className="px-3 py-1 text-sm text-muted-foreground">
                      No active projects on this machine
                    </p>
                  ) : (
                    localProjects.map((project) =>
                      project.status === 'cloning' ? (
                        <CloningProjectRow key={project.name} name={project.name} />
                      ) : (
                        <ProjectRow
                          key={project.name}
                          project={project}
                          sessions={sessionsByProject[project.name] ?? []}
                          isActive={project.name === activeProjectName}
                        />
                      ),
                    )
                  )}
                  {foreignProjects.length > 0 && (
                    <>
                      <div className="mt-3 mb-1 border-t border-sidebar-border" />
                      <div className="mb-1 px-3">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          To restore
                        </span>
                      </div>
                      {foreignProjects.map((project) => (
                        <ProjectRow
                          key={project.name}
                          project={project}
                          sessions={sessionsByProject[project.name] ?? []}
                          isActive={project.name === activeProjectName}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Auth section */}
        <div className="border-t border-sidebar-border py-3">
          <AuthSection onLoginClick={onLoginClick} onClose={onClose} />
        </div>
      </aside>

      {isOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}

      <NewProjectModal isOpen={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <SkillsModal isOpen={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <ProjectPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        projects={projects}
      />
    </>
  );
}
