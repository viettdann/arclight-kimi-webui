import type {
  CloneErrorCode,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectListResponse,
  ProjectSummary,
} from 'shared/types';
import { create } from 'zustand';
import { authFetch } from './auth-fetch';

/**
 * Real `Error` subclass thrown by `create(...)` so consumers can `instanceof`
 * narrow and access `.message` without unsafe casts. Throwing a plain object
 * loses stack trace and breaks `Error` invariants.
 */
export class ProjectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}

/**
 * Decode a non-ok project response into a `ProjectError`. The `.code` is the
 * server's `error` field (or `http_<status>` when the body isn't JSON); the
 * message is looked up in `messages`, falling back to the raw code, then to
 * `<fallback> (<status>)`. Centralizes the shape shared by create/remove.
 */
async function toProjectError(
  res: Response,
  messages: Record<string, string>,
  fallback: string,
): Promise<ProjectError> {
  let code = `http_${res.status}`;
  let message = `${fallback} (${res.status})`;
  try {
    const errBody = (await res.json()) as { error?: string };
    if (errBody.error) {
      code = errBody.error;
      message = messages[errBody.error] ?? errBody.error;
    }
  } catch {
    // Body may not be JSON (proxy/HTML 5xx); keep the generic message.
  }
  return new ProjectError(code, message);
}

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  invalid_name: 'Invalid project name',
  unauthorized: 'Not signed in',
  invalid_url: 'Invalid repository URL',
  unsupported_scheme: 'SSH URLs are not supported — use an HTTPS URL',
  credential_not_found: 'Selected credential not found',
  invalid_provider: 'Invalid provider',
  clone_failed: 'Clone failed',
  clone_timeout: 'Clone timed out',
};

const REMOVE_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'Project not found',
  unauthorized: 'Not signed in',
};

/** Human-readable label for a terminal clone failure, shared by the modal and
 *  the background-clone toast so the wording stays in one place. */
export function cloneErrorMessage(errorCode?: CloneErrorCode): string {
  return errorCode === 'clone_timeout' ? 'Clone timed out' : 'Clone failed';
}

/** Remove a project from the list and forget its expanded flag. Shared by the
 *  optimistic `dropProject` and the server-confirmed `remove`. */
function dropFromState(
  s: { projects: ProjectSummary[]; expanded: Record<string, boolean> },
  name: string,
): { projects: ProjectSummary[]; expanded: Record<string, boolean> } {
  const { [name]: _dropped, ...expanded } = s.expanded;
  return { projects: s.projects.filter((p) => p.name !== name), expanded };
}

interface ProjectsState {
  projects: ProjectSummary[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  expanded: Record<string, boolean>;
  fetch: () => Promise<void>;
  create: (opts: {
    name?: string;
    source?: ProjectCreateRequest['source'];
  }) => Promise<ProjectCreateResponse>;
  /** Register a finished project (or flip a cloning placeholder to ready). */
  addProject: (project: ProjectSummary) => void;
  /** Show a still-cloning placeholder (no-op if the project already exists). */
  upsertCloning: (project: ProjectSummary) => void;
  /** Remove a project from the list locally (no API call). */
  dropProject: (name: string) => void;
  /** Cancel an in-flight background clone, then drop its placeholder. */
  cancelClone: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  toggleExpanded: (name: string) => void;
  /** Expand a project (idempotent). Used to auto-open the active session's
   *  project without clobbering a later manual fold. */
  expand: (name: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  status: 'idle',
  error: null,
  expanded: {},

  fetch: async () => {
    set({ status: 'loading', error: null });
    try {
      const res = await authFetch('/api/projects');
      if (!res.ok) {
        set({ status: 'error', error: `http_${res.status}` });
        return;
      }
      const body = (await res.json()) as ProjectListResponse;
      set({ projects: body.projects, status: 'ready', error: null });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'network_error' });
    }
  },

  create: async (opts): Promise<ProjectCreateResponse> => {
    const req: ProjectCreateRequest = { name: opts.name, source: opts.source };
    const res = await authFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw await toProjectError(res, CREATE_ERROR_MESSAGES, 'Request failed');
    }
    const project = (await res.json()) as ProjectCreateResponse;
    // A cloning project's folder is claimed but still filling: show a cloning
    // placeholder now; `clone_progress` flips it to ready (or drops it) later.
    if (project.status === 'cloning') {
      get().upsertCloning(project);
    } else {
      set((s) => ({
        projects: [...s.projects, project],
        expanded: { ...s.expanded, [project.name]: true },
      }));
    }
    return project;
  },

  addProject: (project) => {
    const ready: ProjectSummary = { ...project, status: 'ready' };
    set((s) => ({
      projects: s.projects.some((p) => p.name === project.name)
        ? s.projects.map((p) => (p.name === project.name ? ready : p))
        : [...s.projects, ready],
      expanded: { ...s.expanded, [project.name]: true },
    }));
  },

  upsertCloning: (project) => {
    // A cloning placeholder is a non-expandable row, so leave `expanded` alone —
    // `addProject` sets it once the clone completes.
    set((s) =>
      s.projects.some((p) => p.name === project.name)
        ? s
        : { projects: [...s.projects, { ...project, status: 'cloning' as const }] },
    );
  },

  dropProject: (name) => {
    set((s) => (s.projects.some((p) => p.name === name) ? dropFromState(s, name) : s));
  },

  cancelClone: async (name: string): Promise<void> => {
    // Best-effort: the server aborts the clone and pushes a terminal frame that
    // drops the placeholder; drop it locally too for an instant response. Guard
    // on `cloning` so a stale click can't drop a project that already finished.
    if (!get().projects.some((p) => p.name === name && p.status === 'cloning')) return;
    await authFetch(`/api/projects/${encodeURIComponent(name)}/clone`, { method: 'DELETE' }).catch(
      () => {},
    );
    get().dropProject(name);
  },

  remove: async (name: string): Promise<void> => {
    const res = await authFetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) {
      throw await toProjectError(res, REMOVE_ERROR_MESSAGES, 'Delete failed');
    }
    set((s) => dropFromState(s, name));
  },

  toggleExpanded: (name: string) => {
    set((s) => ({ expanded: { ...s.expanded, [name]: !s.expanded[name] } }));
  },

  expand: (name: string) => {
    // No-op if already expanded so a manual fold of the active project isn't
    // re-opened on every unrelated store update.
    set((s) => (s.expanded[name] ? s : { expanded: { ...s.expanded, [name]: true } }));
  },
}));
