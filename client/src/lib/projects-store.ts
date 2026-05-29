import type {
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

interface ProjectsState {
  projects: ProjectSummary[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  expanded: Record<string, boolean>;
  fetch: () => Promise<void>;
  create: (opts: {
    name?: string;
    source?: ProjectCreateRequest['source'];
  }) => Promise<ProjectSummary>;
  remove: (name: string) => Promise<void>;
  toggleExpanded: (name: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
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

  create: async (opts): Promise<ProjectSummary> => {
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
    set((s) => ({
      projects: [...s.projects, project],
      expanded: { ...s.expanded, [project.name]: true },
    }));
    return project;
  },

  remove: async (name: string): Promise<void> => {
    const res = await authFetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) {
      throw await toProjectError(res, REMOVE_ERROR_MESSAGES, 'Delete failed');
    }
    set((s) => {
      const { [name]: _dropped, ...expanded } = s.expanded;
      return { projects: s.projects.filter((p) => p.name !== name), expanded };
    });
  },

  toggleExpanded: (name: string) => {
    set((s) => ({ expanded: { ...s.expanded, [name]: !s.expanded[name] } }));
  },
}));
