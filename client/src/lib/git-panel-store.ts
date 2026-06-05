import type {
  GitBranchResponse,
  GitCommandResponse,
  GitLogResponse,
  GitStatusResponse,
  GitSubcommand,
} from 'shared/types/git-credentials';
import { toast } from 'sonner';
import { create } from 'zustand';
import {
  commitGit,
  executeGitCommand,
  fetchGitBranches,
  fetchGitLog,
  fetchGitStatus,
  fetchProjectGitMetadata,
  linkGitCredential,
  NotGitRepoError,
} from '../api/git';

interface CommandResult {
  type: 'success' | 'error';
  message: string;
}

interface GitPanelState {
  /** Currently scoped project. */
  projectName: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'not_git_repo';
  error: string | null;

  // Cached data
  statusData: GitStatusResponse | null;
  branchData: GitBranchResponse | null;
  logData: GitLogResponse | null;

  /** Credential persisted as linked to this project (auto-injected on remote ops). */
  linkedCredentialId: string | null;

  // Command result
  commandResult: CommandResult | null;
  /** True while a command is executing. */
  isBusy: boolean;

  // Auth prompt state
  authRequired: boolean;
  /**
   * Why the banner is showing: 'missing' (no/expired/wrong credential — re-pick
   * helps) vs 'forbidden' (credential applied but remote refused on scope —
   * pick one with more access). Null when no prompt is up.
   */
  authKind: 'missing' | 'forbidden' | null;
  authCommand: GitSubcommand | null;
  authArgs: string[] | null;

  // Actions
  setProject: (name: string | null) => void;
  refreshStatus: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  refreshLog: () => Promise<void>;
  loadMetadata: () => Promise<void>;
  /** Persist (or clear) the linked credential for the active project. */
  linkCredential: (credentialId: string | null) => Promise<void>;
  executeCommand: (
    command: GitSubcommand,
    args?: string[],
    credentialId?: string,
  ) => Promise<GitCommandResponse>;
  /** Commit the given paths (GitStatusEntry.path) with a message. Resolves true on success. */
  commitFiles: (files: string[], message: string, amend?: boolean) => Promise<boolean>;
  /** Stage files (git add). Lightweight — no toast, no isBusy. */
  stageFiles: (paths: string[]) => Promise<void>;
  /** Unstage files (git reset HEAD). Lightweight — no toast, no isBusy. */
  unstageFiles: (paths: string[]) => Promise<void>;
  dismissAuth: () => void;
  clear: () => void;
}

const initialState = {
  projectName: null,
  status: 'idle' as const,
  error: null,
  statusData: null,
  branchData: null,
  logData: null,
  linkedCredentialId: null,
  commandResult: null,
  isBusy: false,
  authRequired: false,
  authKind: null,
  authCommand: null,
  authArgs: null,
};

// Remote-touching commands trigger a status+branch refresh and may persist auth.
const REFRESH_AFTER: GitSubcommand[] = ['push', 'pull', 'fetch', 'checkout', 'add', 'reset'];

// Friendly one-line label per command when git has nothing terse to say.
const SUCCESS_LABEL: Partial<Record<GitSubcommand, string>> = {
  pull: 'Pull complete',
  push: 'Push complete',
  fetch: 'Fetch complete',
  checkout: 'Branch switched',
};

// Collapse git's (often multi-line) output to a single short line for a toast —
// dumping a full `git pull` summary makes a giant, hard-to-dismiss notification.
function firstLine(...texts: string[]): string {
  for (const t of texts) {
    const line = t
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    if (line) return line.length > 90 ? `${line.slice(0, 90)}…` : line;
  }
  return '';
}

export const useGitPanelStore = create<GitPanelState>((set, get) => ({
  ...initialState,

  setProject: (name) => {
    const current = get().projectName;
    if (current === name) return;
    set({ ...initialState, projectName: name });
    if (!name) return;
    void get().refreshStatus();
    void get().refreshBranches();
    void get().refreshLog();
    void get().loadMetadata();
  },

  refreshStatus: async () => {
    const { projectName } = get();
    if (!projectName) return;
    set({ status: 'loading', error: null });
    try {
      const data = await fetchGitStatus(projectName);
      set({ statusData: data, status: 'ready', error: null });
    } catch (e) {
      if (e instanceof NotGitRepoError) {
        set({ status: 'not_git_repo', statusData: null });
      } else {
        set({
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed to fetch status',
        });
      }
    }
  },

  refreshBranches: async () => {
    const { projectName } = get();
    if (!projectName) return;
    try {
      const data = await fetchGitBranches(projectName);
      set({ branchData: data });
    } catch (e) {
      // Not-a-repo is surfaced via refreshStatus; only report other failures.
      if (e instanceof NotGitRepoError) return;
      set({
        commandResult: {
          type: 'error',
          message: e instanceof Error ? e.message : 'Failed to fetch branches',
        },
      });
    }
  },

  refreshLog: async () => {
    const { projectName } = get();
    if (!projectName) return;
    try {
      const data = await fetchGitLog(projectName);
      // Guard against a project switch mid-flight.
      if (get().projectName !== projectName) return;
      set({ logData: data });
    } catch {
      // Log is best-effort decoration; a not-a-repo / failure just leaves the
      // history section hidden. Errors are surfaced via refreshStatus.
    }
  },

  loadMetadata: async () => {
    const { projectName } = get();
    if (!projectName) return;
    try {
      const meta = await fetchProjectGitMetadata(projectName);
      // Guard against a project switch mid-flight.
      if (get().projectName !== projectName) return;
      set({ linkedCredentialId: meta?.credentialId ?? null });
    } catch {
      // Metadata is best-effort; absence just means "not linked yet".
    }
  },

  linkCredential: async (credentialId) => {
    const { projectName } = get();
    if (!projectName) return;
    const prev = get().linkedCredentialId;
    set({ linkedCredentialId: credentialId }); // optimistic
    try {
      await linkGitCredential(projectName, credentialId);
    } catch (e) {
      set({ linkedCredentialId: prev }); // revert
      toast.error(e instanceof Error ? e.message : 'Failed to link credential');
    }
  },

  executeCommand: async (command, args, credentialId) => {
    const { projectName } = get();
    if (!projectName) throw new Error('no project');

    set({ isBusy: true, commandResult: null });
    try {
      const result = await executeGitCommand({
        projectName,
        command,
        args: args ?? [],
        credentialId,
      });

      // requiresAuth → re-pickable auth failure; permissionDenied → credential
      // was applied but lacks scope. Both raise the banner (the user may pick a
      // different credential with more access), but with distinct copy.
      if (result.requiresAuth || result.permissionDenied) {
        set({
          authRequired: true,
          authKind: result.permissionDenied ? 'forbidden' : 'missing',
          authCommand: command,
          authArgs: args ?? [],
          isBusy: false,
        });
        return result;
      }

      const isSuccess = result.exitCode === 0;
      const message = isSuccess
        ? firstLine(result.stdout, result.stderr) ||
          SUCCESS_LABEL[command] ||
          `${command} completed`
        : firstLine(result.stderr, result.stdout) || `${command} failed`;

      set({
        commandResult: { type: isSuccess ? 'success' : 'error', message },
        isBusy: false,
        // Any clean run dismisses a pending auth prompt.
        ...(isSuccess
          ? { authRequired: false, authKind: null, authCommand: null, authArgs: null }
          : {}),
      });

      if (isSuccess) {
        toast.success(message);
        // A remote op that succeeded with an explicitly-chosen credential means
        // the user just resolved an auth prompt — persist it so next time the
        // server auto-injects and no prompt appears.
        if (credentialId && (command === 'pull' || command === 'push' || command === 'fetch')) {
          void get().linkCredential(credentialId);
        }
      } else {
        toast.error(message);
      }

      if (REFRESH_AFTER.includes(command)) {
        void get().refreshStatus();
        void get().refreshBranches();
        void get().refreshLog();
      }

      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Command failed';
      set({ commandResult: { type: 'error', message }, isBusy: false });
      toast.error(message);
      throw e;
    }
  },

  commitFiles: async (files, message, amend) => {
    const { projectName } = get();
    if (!projectName) throw new Error('no project');

    set({ isBusy: true, commandResult: null });
    try {
      const result = await commitGit({ projectName, files, message, amend: amend ?? false });

      const isSuccess = result.exitCode === 0;
      const resultMessage = isSuccess
        ? firstLine(result.stdout, result.stderr) || 'Commit complete'
        : firstLine(result.stderr, result.stdout) || 'Commit failed';

      set({
        commandResult: { type: isSuccess ? 'success' : 'error', message: resultMessage },
        isBusy: false,
      });

      if (isSuccess) {
        toast.success(resultMessage);
        void get().refreshStatus();
        void get().refreshLog();
      } else {
        toast.error(resultMessage);
      }

      return isSuccess;
    } catch (e) {
      const resultMessage = e instanceof Error ? e.message : 'Commit failed';
      set({ commandResult: { type: 'error', message: resultMessage }, isBusy: false });
      toast.error(resultMessage);
      return false;
    }
  },

  stageFiles: async (paths) => {
    const { projectName } = get();
    if (!projectName || paths.length === 0) return;
    try {
      const result = await executeGitCommand({
        projectName,
        command: 'add',
        args: ['--', ...paths],
      });
      if (result.exitCode === 0) void get().refreshStatus();
    } catch {
      // Silent — next refreshStatus() will reflect reality
    }
  },

  unstageFiles: async (paths) => {
    const { projectName } = get();
    if (!projectName || paths.length === 0) return;
    try {
      const result = await executeGitCommand({
        projectName,
        command: 'reset',
        args: ['HEAD', '--', ...paths],
      });
      if (result.exitCode === 0) void get().refreshStatus();
    } catch {
      // Silent — next refreshStatus() will reflect reality
    }
  },

  dismissAuth: () => {
    set({ authRequired: false, authKind: null, authCommand: null, authArgs: null });
  },

  clear: () => {
    set(initialState);
  },
}));
