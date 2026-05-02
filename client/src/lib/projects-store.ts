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

interface ProjectsState {
  projects: ProjectSummary[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  expanded: Record<string, boolean>;
  fetch: () => Promise<void>;
  create: (name: string) => Promise<ProjectSummary>;
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

  create: async (name: string): Promise<ProjectSummary> => {
    const req: ProjectCreateRequest = { name };
    const res = await authFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = `Request failed (${res.status})`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) {
          code = errBody.error;
          if (errBody.error === 'invalid_name') message = 'Invalid project name';
          else if (errBody.error === 'unauthorized') message = 'Not signed in';
          else message = errBody.error;
        }
      } catch {
        // Body may not be JSON (proxy/HTML 5xx); fall back to generic message.
      }
      throw new ProjectError(code, message);
    }
    const project = (await res.json()) as ProjectCreateResponse;
    set((s) => ({
      projects: [...s.projects, project],
      expanded: { ...s.expanded, [project.name]: true },
    }));
    return project;
  },

  toggleExpanded: (name: string) => {
    set((s) => ({ expanded: { ...s.expanded, [name]: !s.expanded[name] } }));
  },
}));
