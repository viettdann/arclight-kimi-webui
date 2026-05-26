import { ArrowLeft, Download, FolderTree, MoreHorizontal, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FileEntry, FileListResponse } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { authFetch } from '../lib/auth-fetch';
import { FolderBrand, getFileIcon } from '../lib/file-icons';
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
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const res = await authFetch(`/api/files/list?path=${encodeURIComponent(projectName)}`, {
          signal,
        });
        if (signal?.aborted) return;
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          let message = `HTTP ${res.status} ${res.statusText}`.trim();
          try {
            const j = JSON.parse(text) as { message?: string; error?: string };
            message = j.message ?? j.error ?? message;
          } catch {
            if (text) message = text;
          }
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
    [projectName],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Tree view"
          title="Tree view"
          disabled
          className="hover:bg-sidebar-accent"
        >
          <FolderTree />
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
        ) : state.entries.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">No files yet</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {state.entries.map((entry) => {
              const Brand =
                entry.type === 'dir' ? FolderBrand : getFileIcon(entry.name).Brand;
              return (
                <li
                  key={entry.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
                  title={entry.name}
                >
                  <Brand aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1">{entry.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
