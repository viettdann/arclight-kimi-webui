import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  KeyRound,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { GitStatusEntry, GitSubcommand } from 'shared/types/git-credentials';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownItem, DropdownMenu, DropdownSeparator } from '@/components/ui/dropdown-menu';
import { useGitCredentialsStore } from '../../lib/git-credentials-store';
import { useGitPanelStore } from '../../lib/git-panel-store';
import { useSessionsStore } from '../../lib/sessions-store';
import { CommitDialog } from './commit-dialog';

interface GitPanelProps {
  sessionId: string | undefined;
}

// ─────────────────────────── Building blocks ───────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

// `remotes/origin/dev` → `dev`; a local name passes through. Checking out the
// short name auto-creates a local tracking branch for a remote-only ref.
function shortBranchName(name: string): string {
  if (name.startsWith('remotes/')) return name.split('/').slice(2).join('/');
  return name;
}

// porcelain v2 XY status code → a single badge letter + colour tone. X is the
// staged state, Y the unstaged; we collapse to the single most meaningful
// signal so each file reads as one glyph rather than two cryptic columns.
export type StatusTone = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';

export const TONE_BADGE: Record<StatusTone, string> = {
  modified: 'bg-warning-wash text-warning',
  added: 'bg-success-wash text-success',
  deleted: 'bg-destructive-wash text-destructive',
  untracked: 'bg-muted text-info',
  renamed: 'bg-muted text-info',
};

export function classifyStatus(code: string): { letter: string; tone: StatusTone } {
  const c = code.trim();
  if (c.startsWith('?')) return { letter: 'U', tone: 'untracked' };
  if (c.includes('D')) return { letter: 'D', tone: 'deleted' };
  if (c.includes('R')) return { letter: 'R', tone: 'renamed' };
  if (c.includes('A')) return { letter: 'A', tone: 'added' };
  return { letter: 'M', tone: 'modified' };
}

// ─────────────────────────── Header (title + branch switcher) ───────────────────────────

function GitHeader({ onSwitch, isBusy }: { onSwitch: (name: string) => void; isBusy: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-base font-semibold text-foreground">Git</h4>
      <BranchDropdown onSwitch={onSwitch} isBusy={isBusy} />
    </div>
  );
}

// ─────────────────────────── Branch switcher ───────────────────────────

// The branch name sits in the header corner (where refresh used to be) and
// doubles as the switcher: local + remote refs merged by short name collapse
// into a popover instead of an always-open flat list, so it stays compact and
// scales past a couple of branches. Ahead/behind live on the Pull/Push badges.
function BranchDropdown({
  onSwitch,
  isBusy,
}: {
  onSwitch: (name: string) => void;
  isBusy: boolean;
}) {
  const statusData = useGitPanelStore((s) => s.statusData);
  const branchData = useGitPanelStore((s) => s.branchData);
  const currentBranch = branchData?.currentBranch ?? statusData?.branch ?? null;

  const targets = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of branchData?.branches ?? []) {
      if (b.name.includes('->')) continue; // skip `origin/HEAD -> origin/main`
      const short = shortBranchName(b.name);
      if (!short || short === 'HEAD' || short === currentBranch) continue;
      if (seen.has(short)) continue;
      seen.add(short);
      out.push(short);
    }
    return out;
  }, [branchData, currentBranch]);

  const label = currentBranch ?? '—';
  const hasTargets = targets.length > 0;

  // A bordered "pill" so the branch reads as an interactive control, not a label.
  const trigger = (
    <button
      type="button"
      disabled={isBusy || !hasTargets}
      className="flex min-w-0 max-w-[170px] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-60 aria-expanded:bg-muted"
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {hasTargets && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );

  if (!hasTargets) return trigger;

  return (
    <DropdownMenu trigger={trigger} align="end" contentClassName="max-h-64 overflow-y-auto">
      <DropdownItem disabled icon={<GitBranch />} trailing={<Check />}>
        {label}
      </DropdownItem>
      <DropdownSeparator />
      {targets.map((name) => (
        <DropdownItem key={name} icon={<GitBranch />} onClick={() => onSwitch(name)}>
          {name}
        </DropdownItem>
      ))}
    </DropdownMenu>
  );
}

// ─────────────────────────── Remote actions ───────────────────────────

// Pull/Push are state-aware: the one with outstanding work (behind → Pull,
// ahead → Push) becomes the filled primary and carries a count badge, so the
// panel signals what to do next rather than offering three identical buttons.
function SyncButton({
  label,
  Icon,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  count: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="justify-center px-2"
    >
      <Icon className="h-4 w-4" />
      {label}
      {count > 0 && (
        <span
          className={`ml-0.5 rounded-full px-1 text-[10px] font-semibold tabular-nums ${
            active ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15'
          }`}
        >
          {count}
        </span>
      )}
    </Button>
  );
}

function RemoteActions({
  onAction,
  isBusy,
  ahead,
  behind,
}: {
  onAction: (cmd: GitSubcommand) => void;
  isBusy: boolean;
  ahead: number;
  behind: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <SyncButton
        label="Pull"
        Icon={ArrowDownToLine}
        count={behind}
        active={behind > 0}
        disabled={isBusy}
        onClick={() => onAction('pull')}
      />
      <SyncButton
        label="Push"
        Icon={ArrowUpFromLine}
        count={ahead}
        active={ahead > 0}
        disabled={isBusy}
        onClick={() => onAction('push')}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isBusy}
        onClick={() => onAction('fetch')}
        className="justify-center px-2"
      >
        <RefreshCw className="h-4 w-4" />
        Fetch
      </Button>
    </div>
  );
}

// ─────────────────────────── Changes ───────────────────────────

function ChangeRow({ entry }: { entry: GitStatusEntry }) {
  const { letter, tone } = classifyStatus(entry.statusCode);
  const slash = entry.path.lastIndexOf('/');
  const dir = slash >= 0 ? entry.path.slice(0, slash + 1) : '';
  const file = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
  return (
    <li className="flex items-center gap-2 text-sm" title={entry.path}>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${TONE_BADGE[tone]}`}
      >
        {letter}
      </span>
      <span className="min-w-0 truncate">
        {dir && <span className="text-muted-foreground">{dir}</span>}
        <span className="text-foreground">{file}</span>
      </span>
    </li>
  );
}

function ChangesList({
  entries,
  isBusy,
  isRefreshing,
  onRefresh,
  onCommit,
}: {
  entries: GitStatusEntry[];
  isBusy: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCommit: () => void;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>
          {entries.length > 0 ? `Changes · ${entries.length}` : 'Changes'}
        </SectionLabel>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh status"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={entries.length === 0 || isBusy}
            onClick={onCommit}
            className="h-6 px-2 text-xs"
          >
            <GitCommitHorizontal className="h-3.5 w-3.5" />
            Commit
          </Button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4 shrink-0" />
          Working tree clean
        </p>
      ) : (
        <ul className="max-h-44 space-y-1 overflow-y-auto">
          {entries.map((entry, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional
            <ChangeRow key={`${entry.path}-${i}`} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────── History ───────────────────────────

// Last few commits — surfaces `git log` (already served, never shown before).
// Capped at 3 so it decorates the panel without dominating the 320px column.
function HistoryList() {
  const logData = useGitPanelStore((s) => s.logData);
  const entries = logData?.entries ?? [];
  if (entries.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <SectionLabel>History</SectionLabel>
      <ul className="space-y-1.5">
        {entries.slice(0, 3).map((entry) => (
          <li
            key={entry.hash}
            className="flex items-center gap-2 text-sm"
            title={entry.author ? `${entry.author} · ${entry.message}` : entry.message}
          >
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {entry.hash}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground">{entry.message}</span>
            {entry.date && (
              <span className="shrink-0 text-xs text-muted-foreground">{entry.date}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────── Auth banner ───────────────────────────

// Shown at the top of the panel (not buried in the credential section) the
// moment a remote op fails on auth, so the prompt is impossible to miss.
function AuthBanner({
  isBusy,
  onRetry,
  onDismiss,
}: {
  isBusy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const linkedCredentialId = useGitPanelStore((s) => s.linkedCredentialId);
  const authKind = useGitPanelStore((s) => s.authKind);
  const forbidden = authKind === 'forbidden';
  const title = forbidden ? 'Permission denied' : 'Authentication required';
  const detail = forbidden
    ? 'The credential was applied but the remote refused — the PAT likely lacks write scope (e.g. Code Read & Write). Pick a credential with write access, then retry.'
    : 'Pick a credential below, then retry.';
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-wash p-2.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onRetry}
          disabled={isBusy || linkedCredentialId === null}
        >
          Retry
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────── Credential ───────────────────────────

// Compact one-line footer. The full picker lives in the dialog so many PATs
// never crowd the sidebar.
function CredentialFooter({ onEdit }: { onEdit: () => void }) {
  const credentials = useGitCredentialsStore((s) => s.credentials);
  const linkedCredentialId = useGitPanelStore((s) => s.linkedCredentialId);
  const linked = credentials.find((c) => c.id === linkedCredentialId) ?? null;
  return (
    <div className="flex items-center gap-2 border-t border-border pt-3 text-sm">
      <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
      {linked ? (
        <>
          <span className="min-w-0 truncate font-medium text-foreground">{linked.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{linked.provider}</span>
        </>
      ) : (
        <span className="text-muted-foreground">No credential</span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="ml-auto shrink-0 rounded text-sm font-medium text-primary transition-colors hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

// Modal selection keeps the footer compact (just the linked PAT): with many
// PATs an inline list would dominate the sidebar.
function CredentialDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string | null) => void;
}) {
  const credentials = useGitCredentialsStore((s) => s.credentials);
  const linkedCredentialId = useGitPanelStore((s) => s.linkedCredentialId);
  const [selected, setSelected] = useState<string | null>(linkedCredentialId);

  // Seed the local selection from the persisted link each time the modal opens.
  useEffect(() => {
    if (open) setSelected(linkedCredentialId);
  }, [open, linkedCredentialId]);

  const Row = ({ id, label, sub }: { id: string | null; label: string; sub?: string }) => {
    const active = selected === id;
    return (
      <button
        type="button"
        onClick={() => setSelected(id)}
        className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
          active
            ? 'border-primary bg-primary/5 ring-1 ring-primary'
            : 'border-border hover:bg-accent'
        }`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {active && <Check className="h-4 w-4 text-primary" />}
        </span>
        <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
        {sub && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{sub}</span>}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link git credential</DialogTitle>
          <DialogDescription>
            Chọn PAT dùng cho pull/push/fetch của project này. Lưu vào DB để lần sau không phải chọn
            lại.
          </DialogDescription>
        </DialogHeader>

        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có credential. Thêm trong Settings → Git Credentials.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            <li>
              <Row id={null} label="None" />
            </li>
            {credentials.map((c) => (
              <li key={c.id}>
                <Row id={c.id} label={c.label} sub={c.provider} />
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(selected);
              onOpenChange(false);
            }}
            disabled={credentials.length === 0}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Main panel ───────────────────────────

export function GitPanel({ sessionId }: GitPanelProps) {
  const projectName = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.projectName ?? null,
  );

  const status = useGitPanelStore((s) => s.status);
  const statusData = useGitPanelStore((s) => s.statusData);
  const isBusy = useGitPanelStore((s) => s.isBusy);
  const authRequired = useGitPanelStore((s) => s.authRequired);
  const authCommand = useGitPanelStore((s) => s.authCommand);
  const authArgs = useGitPanelStore((s) => s.authArgs);
  const linkedCredentialId = useGitPanelStore((s) => s.linkedCredentialId);

  const setProject = useGitPanelStore((s) => s.setProject);
  const executeCommand = useGitPanelStore((s) => s.executeCommand);
  const linkCredential = useGitPanelStore((s) => s.linkCredential);
  const dismissAuth = useGitPanelStore((s) => s.dismissAuth);
  const refreshStatus = useGitPanelStore((s) => s.refreshStatus);

  const ensureCredentialsLoaded = useGitCredentialsStore((s) => s.ensureLoaded);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);

  useEffect(() => {
    setProject(projectName);
  }, [projectName, setProject]);

  useEffect(() => {
    ensureCredentialsLoaded();
  }, [ensureCredentialsLoaded]);

  const handleAction = useCallback(
    (cmd: GitSubcommand) => void executeCommand(cmd),
    [executeCommand],
  );

  const handleBranchSwitch = useCallback(
    (name: string) => void executeCommand('checkout', [name]),
    [executeCommand],
  );

  const handleRetry = useCallback(() => {
    if (authCommand && linkedCredentialId) {
      void executeCommand(authCommand, authArgs ?? [], linkedCredentialId);
    }
  }, [authCommand, authArgs, linkedCredentialId, executeCommand]);

  // Hide entirely for projects that aren't git repos (or before one is picked):
  // the sidebar stacks panels open, so an empty git block would be pure noise.
  if (!projectName || status === 'not_git_repo') return null;

  if (status === 'loading' && !statusData) {
    return (
      <div className="space-y-3 p-4">
        <h4 className="text-base font-semibold text-foreground">Git</h4>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  const entries = statusData?.entries ?? [];
  const ahead = statusData?.ahead ?? 0;
  const behind = statusData?.behind ?? 0;

  return (
    <div className="space-y-4 p-4">
      <GitHeader onSwitch={handleBranchSwitch} isBusy={isBusy} />
      {authRequired && <AuthBanner isBusy={isBusy} onRetry={handleRetry} onDismiss={dismissAuth} />}
      <RemoteActions onAction={handleAction} isBusy={isBusy} ahead={ahead} behind={behind} />
      <ChangesList
        entries={entries}
        isBusy={isBusy}
        isRefreshing={status === 'loading'}
        onRefresh={() => void refreshStatus()}
        onCommit={() => setCommitOpen(true)}
      />
      <HistoryList />
      <CredentialFooter onEdit={() => setDialogOpen(true)} />
      <CredentialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={(id) => void linkCredential(id)}
      />
      <CommitDialog open={commitOpen} onOpenChange={setCommitOpen} />
    </div>
  );
}
