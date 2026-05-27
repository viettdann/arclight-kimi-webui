import { LogOut, Plus, Settings, SquarePen, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { WSMessageType } from 'shared/types';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '../lib/auth-store';
import { useNewSessionStore } from '../lib/new-session-store';
import { useProjectsStore } from '../lib/projects-store';
import { groupByProject, useSessionsStore } from '../lib/sessions-store';
import { useSidebarViewStore } from '../lib/sidebar-view-store';
import { wsClient } from '../lib/ws-client';
import { FileManagementView } from './file-management-view';
import { NewProjectModal } from './new-project-modal';
import { ProjectPickerModal } from './project-picker-modal';
import { ProjectRow } from './project-row';
import { SkillsModal } from './skills-modal';
import { showToast } from './toast-provider';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginClick: () => void;
}

function AuthSection({ onLoginClick }: { onLoginClick: () => void }) {
  // Single-field selectors avoid re-renders on unrelated auth-store changes.
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);

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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => clearSession('manual')}
          aria-label="Log out"
        >
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

const REFRESH_TRIGGER_TYPES = new Set<WSMessageType>([
  'snapshot',
  'session_state',
  'title_update',
  'project_adopted',
]);
// Cheap pre-filter so the streaming hot path (text_delta, thinking_delta, …)
// avoids JSON.parse on every frame. We only parse when the raw frame contains
// at least one trigger-type literal.
const REFRESH_RAW_HINTS = ['"snapshot"', '"session_state"', '"title_update"', '"project_adopted"'];

export function Sidebar({ isOpen, onClose, onLoginClick }: SidebarProps) {
  const navigate = useNavigate();
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
  // session-mutating events. Projects refresh only on events that can flip a
  // project's origin (`session_state` covers cascade-via-resume, `project_adopted`
  // covers explicit whole-project adoption); `snapshot`/`title_update` never
  // change the project set.
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
      if (type === 'session_state' || type === 'project_adopted') projectsDirty = true;
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
  }, [onClose]);

  // ⌘N / Ctrl+N hotkey → new task.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'n') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (target.isContentEditable) return;
      }
      e.preventDefault();
      e.stopPropagation();
      triggerNewTask();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [triggerNewTask]);

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
        className={`fixed left-0 top-0 z-40 flex h-screen w-[300px] flex-col border-r border-border bg-sidebar transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            M
          </div>
          <span className="text-sm font-semibold">More Than Coding</span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            onClick={triggerNewTask}
            className="w-full justify-between px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <span className="flex items-center gap-2">
              <SquarePen />
              New task
            </span>
            <kbd className="rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground">
              ⌘N
            </kbd>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onClose?.();
              setSkillsOpen(true);
            }}
            className="w-full justify-start gap-2 px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Zap />
            Skills
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onClose?.();
              navigate('/settings');
            }}
            className="w-full justify-start gap-2 px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Settings />
            Settings
          </Button>
        </nav>

        {showFiles && activeProjectName ? (
          <FileManagementView projectName={activeProjectName} />
        ) : (
          <div className="flex flex-1 flex-col px-3 py-2 min-h-0">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Project list
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  onClose?.();
                  setNewProjectOpen(true);
                }}
                aria-label="Add project"
              >
                <Plus />
              </Button>
            </div>

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
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <div className="rounded-full bg-muted p-3">
                    <Plus className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No projects yet</p>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {localProjects.length === 0 && foreignProjects.length > 0 ? (
                    <p className="px-3 py-1 text-sm text-muted-foreground">
                      No active projects on this machine
                    </p>
                  ) : (
                    localProjects.map((project) => (
                      <ProjectRow
                        key={project.name}
                        project={project}
                        sessions={sessionsByProject[project.name] ?? []}
                        isActive={project.name === activeProjectName}
                      />
                    ))
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
          <AuthSection onLoginClick={onLoginClick} />
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
