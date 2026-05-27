import {
  ArrowLeft,
  ChevronRight,
  CornerLeftUp,
  Download,
  MoreHorizontal,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FileEntry, FileListResponse } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { authFetch, parseError } from '../lib/auth-fetch';
import { FolderBrand, getFileIcon } from '../lib/file-icons';
import { useOpenFileStore } from '../lib/open-file-store';
import { useSidebarViewStore } from '../lib/sidebar-view-store';

interface FileManagementViewProps {
  projectName: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; entries: FileEntry[] }
  | { status: 'error'; message: string };

export function FileManagementView({ projectName }: FileManagementViewProps) {
  const backToTasks = useSidebarViewStore((s) => s.backToTasks);
  const openFile = useOpenFileStore((s) => s.open);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Navigation is replace-style (one level at a time). `currentPath` is the
  // dir being listed; it never escapes above `projectName` (the user root).
  const [currentPath, setCurrentPath] = useState(projectName);

  // Switching project resets navigation back to its root.
  useEffect(() => {
    setCurrentPath(projectName);
  }, [projectName]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const res = await authFetch(`/api/files/list?path=${encodeURIComponent(currentPath)}`, {
          signal,
        });
        if (signal?.aborted) return;
        if (!res.ok) {
          const message = await parseError(res);
          if (signal?.aborted) return;
          setState({ status: 'error', message });
          return;
        }
        const body = (await res.json()) as FileListResponse;
        if (signal?.aborted) return;
        const sorted = [...body.entries].sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setState({ status: 'ready', entries: sorted });
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'network_error',
        });
      }
    },
    [currentPath],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Breadcrumb levels from `projectName` (root) down to `currentPath`. Each
  // segment carries the absolute path to jump to when clicked.
  const crumbs = (() => {
    const rootDepth = projectName.split('/').length;
    const parts = currentPath.split('/');
    return parts.slice(rootDepth - 1).map((name, i) => ({
      name,
      path: parts.slice(0, rootDepth + i).join('/'),
    }));
  })();
  const atRoot = currentPath === projectName;

  const enterDir = (name: string) => setCurrentPath(`${currentPath}/${name}`);
  const goUp = () => {
    if (atRoot) return;
    setCurrentPath(currentPath.slice(0, currentPath.lastIndexOf('/')));
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-sidebar-border">
        <Button
          type="button"
          variant="ghost"
          onClick={backToTasks}
          className="flex-1 justify-start gap-1.5 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span className="truncate">Back to Task List</span>
        </Button>
        <DropdownMenu
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="More actions"
              title="More Actions"
              className="hover:bg-sidebar-accent"
            >
              <MoreHorizontal />
            </Button>
          }
        >
          <DropdownItem icon={<RefreshCw />} onClick={() => void load()}>
            Refresh
          </DropdownItem>
          <DropdownItem disabled icon={<Upload />}>
            Upload Local File
          </DropdownItem>
          <DropdownItem disabled icon={<Download />}>
            Download all
          </DropdownItem>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-0.5 overflow-x-auto px-3 py-1.5 text-xs text-muted-foreground border-b border-sidebar-border">
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
            <button
              type="button"
              onClick={() => setCurrentPath(crumb.path)}
              disabled={i === crumbs.length - 1}
              className="truncate rounded px-1 py-0.5 hover:bg-sidebar-accent disabled:hover:bg-transparent disabled:text-sidebar-foreground disabled:font-medium"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-3 py-2">
        {state.status === 'loading' ? (
          <div className="flex flex-col gap-2 px-2 py-1">
            <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : state.status === 'error' ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">Failed to load files</p>
            <p className="text-xs text-muted-foreground/80">{state.message}</p>
            <Button type="button" variant="outline" size="xs" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : state.entries.length === 0 && atRoot ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">No files yet</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {!atRoot && (
              <li>
                <button
                  type="button"
                  onClick={goUp}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
                  title="Up one level"
                >
                  <CornerLeftUp aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">..</span>
                </button>
              </li>
            )}
            {state.entries.map((entry) => {
              const isDir = entry.type === 'dir';
              const Brand = isDir ? FolderBrand : getFileIcon(entry.name).Brand;
              const onClick = isDir
                ? () => enterDir(entry.name)
                : entry.type === 'file'
                  ? () => openFile(`${currentPath}/${entry.name}`, entry.name)
                  : undefined;
              return (
                <li key={entry.name}>
                  <button
                    type="button"
                    onClick={onClick}
                    disabled={onClick === undefined}
                    className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                    title={entry.name}
                  >
                    <Brand aria-hidden className="h-4 w-4 shrink-0" />
                    <span className="truncate flex-1">{entry.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
