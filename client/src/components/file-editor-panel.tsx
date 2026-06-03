import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
import { Code2, Download, Eye, FileWarning, Loader2, Save, WrapText, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileWriteResponse } from 'shared/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authFetch, parseError } from '../lib/auth-fetch';
import { type CodeLanguage, languageForFilename } from '../lib/code-language';
import { getFileIcon } from '../lib/file-icons';
import { useOpenFileStore } from '../lib/open-file-store';
import { FrontmatterTable, markdownComponents, splitFrontmatter } from './blocks/markdown';

function isMarkdown(name: string): boolean {
  const lc = name.toLowerCase();
  return lc.endsWith('.md') || lc.endsWith('.markdown');
}
function isHtml(name: string): boolean {
  const lc = name.toLowerCase();
  return lc.endsWith('.html') || lc.endsWith('.htm');
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'binary' }
  | { status: 'error'; message: string };

interface PanelInner {
  path: string;
  name: string;
}

function EditorBody({ path, name }: PanelInner) {
  const close = useOpenFileStore((s) => s.close);
  const setDirty = useOpenFileStore((s) => s.setDirty);
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' });
  const [value, setValue] = useState('');
  const [original, setOriginal] = useState('');
  const [preview, setPreview] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = fetchState.status === 'ready' && value !== original;

  // Keep the store's dirty flag in sync so close()/open() can guard on it.
  // The effect only fires when `dirty` flips across the boundary, not per
  // keystroke; reset to clean on unmount so a stale flag can't block the next.
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  const canPreview = isMarkdown(name);
  const htmlFile = isHtml(name);

  // The Lezer grammar loads on demand (one chunk per language). The editor
  // mounts as plain text and reconfigures to highlighted once the chunk lands —
  // the same plain→upgrade path the markdown code blocks use.
  const [lang, setLang] = useState<CodeLanguage | null>(null);
  useEffect(() => {
    let alive = true;
    languageForFilename(name).then((l) => {
      if (alive) setLang(l);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  // Language extension (once resolved) plus optional line wrapping.
  const extensions = useMemo(() => {
    const exts: Extension[] = lang ? [lang] : [];
    if (wrap) exts.push(EditorView.lineWrapping);
    return exts;
  }, [lang, wrap]);

  // Split YAML frontmatter off for the markdown preview (rendered as a table).
  // Only computed when actually previewing markdown.
  const frontmatter = useMemo(
    () => (canPreview && preview ? splitFrontmatter(value) : { data: null, body: value }),
    [canPreview, preview, value],
  );

  useEffect(() => {
    const ac = new AbortController();
    setFetchState({ status: 'loading' });
    setPreview(false);
    setSaveError(null);
    (async () => {
      try {
        const res = await authFetch(`/api/files/read?path=${encodeURIComponent(path)}`, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        if (!res.ok) {
          setFetchState({ status: 'error', message: await parseError(res) });
          return;
        }
        const buf = await res.arrayBuffer();
        if (ac.signal.aborted) return;
        // Strict UTF-8 decode; binary/invalid bytes → "can't view".
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch {
          setFetchState({ status: 'binary' });
          return;
        }
        setValue(text);
        setOriginal(text);
        setFetchState({ status: 'ready' });
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFetchState({
          status: 'error',
          message: err instanceof Error ? err.message : 'network_error',
        });
      }
    })();
    return () => ac.abort();
  }, [path]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authFetch('/api/files/write', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content: value }),
      });
      if (!res.ok) {
        setSaveError(await parseError(res));
        return;
      }
      (await res.json()) as FileWriteResponse;
      setOriginal(value); // clear dirty
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setSaving(false);
    }
  }, [path, value]);

  const Brand = getFileIcon(name).Brand;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {/* Left: code/preview segmented toggle (markdown & html only). */}
        {(canPreview || htmlFile) && (
          <div className="flex shrink-0 items-center rounded-lg border border-border p-0.5">
            <button
              type="button"
              aria-label="Show source"
              aria-pressed={!preview}
              title="Source"
              disabled={fetchState.status !== 'ready'}
              onClick={() => setPreview(false)}
              className={`flex size-6 items-center justify-center rounded-md transition-colors disabled:opacity-50 ${
                !preview
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code2 className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Preview"
              aria-pressed={preview}
              title={htmlFile ? 'Preview unavailable for HTML' : 'Preview'}
              disabled={htmlFile || fetchState.status !== 'ready'}
              onClick={() => setPreview(true)}
              className={`flex size-6 items-center justify-center rounded-md transition-colors disabled:opacity-50 ${
                preview ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="size-3.5" />
            </button>
          </div>
        )}

        <Brand aria-hidden className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm font-medium" title={path}>
          {name}
        </span>
        {dirty && (
          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />
        )}

        {/* Right: download · wrap · save · close. */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Download"
            title="Download"
            render={
              <a href={`/api/files/download?path=${encodeURIComponent(path)}`} download={name} />
            }
          >
            <Download />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle word wrap"
            aria-pressed={wrap}
            title={wrap ? 'Word wrap: on' : 'Word wrap: off'}
            disabled={preview}
            className={wrap ? 'text-primary' : 'text-muted-foreground'}
            onClick={() => setWrap((w) => !w)}
          >
            <WrapText />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Save"
            title="Save"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            title="Close"
            onClick={close}
          >
            <X />
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          Save failed: {saveError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {fetchState.status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : fetchState.status === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">Failed to load file</p>
            <p className="text-xs text-muted-foreground/80">{fetchState.message}</p>
          </div>
        ) : fetchState.status === 'binary' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <FileWarning className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Không xem được tệp này</p>
            <a
              href={`/api/files/download?path=${encodeURIComponent(path)}`}
              download={name}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Download className="h-4 w-4" />
              Download
            </a>
          </div>
        ) : preview && canPreview ? (
          <div className="max-w-none px-4 py-3 select-text">
            {frontmatter.data && <FrontmatterTable data={frontmatter.data} />}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {frontmatter.body}
            </ReactMarkdown>
          </div>
        ) : (
          <CodeMirror
            value={value}
            extensions={extensions}
            onChange={setValue}
            height="100%"
            className="h-full text-sm"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Editor panel. Owns a dirty-confirm gate: closing or switching files while
 * the buffer has unsaved edits prompts via a dialog before discarding.
 */
export function FileEditorPanel() {
  const openFile = useOpenFileStore((s) => s.openFile);
  const pending = useOpenFileStore((s) => s.pending);
  const confirmPending = useOpenFileStore((s) => s.confirmPending);
  const cancelPending = useOpenFileStore((s) => s.cancelPending);
  if (openFile == null) return null;
  return (
    <>
      {/* `key` forces a fresh EditorBody (dirty/fetch state) per file path. */}
      <EditorBody key={openFile.path} path={openFile.path} name={openFile.name} />
      <DiscardChangesDialog
        open={pending != null}
        onCancel={cancelPending}
        onConfirm={confirmPending}
      />
    </>
  );
}

function DiscardChangesDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            This file has unsaved edits. Closing will discard them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
