import { FolderUp, Loader2, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillDTO, SkillUploadResponse } from 'shared/types';
import { deleteSkill, listSkills, setSkillEnabled, uploadSkills } from '@/api/skills';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { showToast } from './toast-provider';

interface SkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACCEPT = '.md,.zip,.skill';

// OS junk folder/file names that do not start with a dot and so are not caught
// by the dotfile rule alone. Mirrors the server's `isJunkPath` scoping.
const JUNK_NAMES = new Set<string>([
  '__MACOSX',
  'Thumbs.db',
  'Thumbs.db:encryptable',
  'desktop.ini',
  'ehthumbs.db',
  'ehthumbs_vista.db',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

/** True if any segment of `relPath` is a dotfile/dotfolder or known OS junk. */
function isJunkPath(relPath: string): boolean {
  for (const seg of relPath.split('/').filter(Boolean)) {
    if (seg === '.') continue;
    if (seg.startsWith('.')) return true;
    if (JUNK_NAMES.has(seg)) return true;
  }
  return false;
}

/** Browser-only File augmentation: `webkitRelativePath` is present for folder
 *  and directory-drop entries but absent from lib.dom's File type narrowing. */
type FileWithPath = File & { webkitRelativePath?: string };

function relPathOf(file: File): string {
  return (file as FileWithPath).webkitRelativePath ?? '';
}

type FileType = 'md' | 'zip' | 'skill' | 'folder';

function detectType(file: File): FileType | null {
  // Folder must be checked first: a `.md` inside a dropped folder is part of a
  // folder skill, not a standalone SKILL.md.
  if (relPathOf(file).includes('/')) return 'folder';
  const name = file.name.toLowerCase();
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.zip')) return 'zip';
  if (name.endsWith('.skill')) return 'skill';
  return null;
}

/** Recursively read every file out of a dropped directory entry. Dropped
 *  directories never appear in `dataTransfer.files`, so they must be walked via
 *  the FileSystem entries API; `readEntries` returns partial batches. */
async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];

  const readBatch = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  const getFile = (fileEntry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => fileEntry.file(resolve, reject));

  async function traverse(dir: FileSystemDirectoryEntry) {
    const reader = dir.createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await readBatch(reader);
      for (const child of batch) {
        if (child.isFile) {
          const file = await getFile(child as FileSystemFileEntry);
          // fullPath starts with "/"; strip it to mirror webkitRelativePath.
          Object.defineProperty(file, 'webkitRelativePath', {
            value: child.fullPath.slice(1),
            writable: false,
            configurable: true,
          });
          files.push(file);
        } else if (child.isDirectory) {
          await traverse(child as FileSystemDirectoryEntry);
        }
      }
    } while (batch.length > 0);
  }

  await traverse(entry);
  return files;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function SkillsModal({ isOpen, onClose }: SkillsModalProps) {
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [junkSkipped, setJunkSkipped] = useState(0);
  const [result, setResult] = useState<SkillUploadResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSkills(await listSkills());
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : 'Failed to load skills',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Fresh open starts with a clean upload result + junk tally.
    setResult(null);
    setJunkSkipped(0);
    void refresh();
  }, [isOpen, refresh]);

  // `webkitdirectory` is a non-standard attribute absent from React's prop
  // types, so it is set imperatively on mount.
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const upload = useCallback(
    async (fileList: FileList | File[]) => {
      let skipped = 0;
      const files: File[] = [];
      for (const file of Array.from(fileList)) {
        const relPath = relPathOf(file) || file.name;
        if (isJunkPath(relPath)) {
          skipped++;
          continue;
        }
        if (detectType(file)) files.push(file);
      }
      if (skipped > 0) setJunkSkipped((n) => n + skipped);
      if (files.length === 0) {
        if (skipped === 0) {
          showToast({ message: 'No valid .md, .zip, .skill, or folder files', type: 'error' });
        }
        return;
      }

      const form = new FormData();
      // Multipart serialization strips webkitRelativePath, so a parallel `paths`
      // field carries folder structure — appended one-per-file, same order. The
      // Set keeps the files[i] ↔ paths[i] ratio 1:1 across duplicate entries.
      const seen = new Set<File>();
      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        form.append('files', file);
        form.append('paths', relPathOf(file));
      }

      setUploading(true);
      try {
        const res = await uploadSkills(form);
        setResult(res);
        await refresh();
      } catch (err) {
        showToast({
          message: err instanceof Error ? err.message : 'Upload failed',
          type: 'error',
        });
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const items = e.dataTransfer.items;
      if (items?.length) {
        const collected: File[] = [];
        for (const item of Array.from(items)) {
          // webkitGetAsEntry is non-standard; guard with optional chaining.
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            collected.push(...(await readDirectoryEntries(entry as FileSystemDirectoryEntry)));
          } else if (entry?.isFile) {
            const file = item.getAsFile();
            if (file) collected.push(file);
          }
        }
        if (collected.length > 0) {
          await upload(collected);
          return;
        }
      }

      // Fallback for browsers without the entries API.
      if (e.dataTransfer.files.length > 0) await upload(e.dataTransfer.files);
    },
    [upload],
  );

  async function handleToggle(skill: SkillDTO, enabled: boolean) {
    setBusyId(skill.id);
    try {
      await setSkillEnabled(skill.id, enabled);
      await refresh();
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : 'Failed to update skill',
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(skill: SkillDTO) {
    if (!window.confirm(`Delete skill "${skill.name}"?`)) return;
    setBusyId(skill.id);
    try {
      await deleteSkill(skill.id);
      showToast({ message: `Deleted "${skill.name}"`, type: 'info' });
      await refresh();
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : 'Failed to delete skill',
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  const hasResult =
    result && (result.created.length > 0 || result.updated.length > 0 || result.errors.length > 0);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl flex max-h-[85vh] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription>
            Upload skills as a SKILL.md file, a .zip/.skill archive, or a folder. Enabled skills are
            available to your sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {/* Dropzone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-border-strong',
            )}
          >
            <Upload className="size-6 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Drag &amp; drop files or a folder here
              <div className="mt-0.5 text-xs">
                .md &middot; .zip &middot; .skill &middot; folder
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploading}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <Upload /> Browse Files
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploading}
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
              >
                <FolderUp /> Browse Folder
              </Button>
            </div>
            {uploading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Uploading…
              </div>
            )}
            {junkSkipped > 0 && (
              <div className="text-xs text-muted-foreground">
                Skipped {junkSkipped} junk file{junkSkipped === 1 ? '' : 's'} (e.g. .DS_Store,
                __MACOSX/).
              </div>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Upload result strip */}
          {hasResult && (
            <div className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              {result?.created.map((name) => (
                <div key={`c-${name}`} className="text-success">
                  Created <span className="font-mono">{name}</span>
                </div>
              ))}
              {result?.updated.map((name) => (
                <div key={`u-${name}`} className="text-primary">
                  Updated <span className="font-mono">{name}</span>
                </div>
              ))}
              {result?.errors.map((err, i) => (
                <div key={`e-${err.name ?? i}`} className="text-destructive">
                  {err.name ? <span className="font-mono">{err.name}</span> : 'Error'}:{' '}
                  {err.message}
                </div>
              ))}
            </div>
          )}

          {/* Skills list */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Your skills ({skills.length})
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : skills.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-8 text-center text-xs italic text-muted-foreground">
                No skills yet. Upload one above.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {skills.map((skill) => (
                  <li
                    key={skill.id}
                    className={cn(
                      'flex items-start gap-3 px-3 py-2.5 transition-colors',
                      skill.enabled ? 'hover:bg-muted' : 'opacity-60 hover:bg-muted',
                    )}
                  >
                    <Checkbox
                      checked={skill.enabled}
                      disabled={busyId === skill.id}
                      className="mt-0.5"
                      onChange={(e) => void handleToggle(skill, e.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{skill.name}</span>
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {skill.name}
                        </span>
                        {!skill.enabled && (
                          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Disabled
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {skill.description}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {skill.fileCount} file{skill.fileCount === 1 ? '' : 's'} &middot;{' '}
                        {formatBytes(skill.sizeBytes)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busyId === skill.id}
                      aria-label={`Delete ${skill.name}`}
                      onClick={() => void handleDelete(skill)}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
