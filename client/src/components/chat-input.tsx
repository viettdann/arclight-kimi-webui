import { Brain, Check, ChevronDown, Send, ShieldCheck, Slash, Square, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { SlashCommand } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { useChatStore } from '../lib/chat-store';
import { resolveModel, useKimiConfigStore } from '../lib/kimi-config-store';
import { useSessionsStore } from '../lib/sessions-store';
import { sendWS } from '../lib/ws-send';
import { ConfirmYoloDialog } from './confirm-yolo-dialog';

// Modes are resolved client-side: SDK still provides the description for these
// command names, but they are grouped under "Modes" instead of "Commands".
const MODE_COMMANDS = ['afk'];
// Excluded from every group — handled by dedicated UI, not the composer.
const EXCLUDED_COMMANDS = new Set(['plan', 'yolo']);

// Sessions where the user has acknowledged the YOLO warning. Enabling YOLO
// confirms once per session (per app load); turning it off never prompts.
const yoloAcknowledged = new Set<string>();

// `startIdx` is the offset of the group's first item within the flat
// `flatItems` list, so highlight maps to the flat index without a render-time
// counter mutation.
type CommandGroup = { label: string; items: SlashCommand[]; startIdx: number };

/** Extract the query from text starting with '/': the part after '/' up to the first space. */
function parseSlashQuery(text: string): string | null {
  if (text[0] !== '/') return null;
  const rest = text.slice(1);
  // A space means the command is already chosen → close the picker.
  if (/\s/.test(rest)) return null;
  return rest;
}

function matchesQuery(cmd: SlashCommand, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystacks = [cmd.name, ...(cmd.aliases ?? [])].map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(q));
}

/** startsWith ranks above includes (lower rank sorts first). */
function matchRank(cmd: SlashCommand, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const haystacks = [cmd.name, ...(cmd.aliases ?? [])].map((s) => s.toLowerCase());
  if (haystacks.some((h) => h.startsWith(q))) return 0;
  return 1;
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </span>
  );
}

export function ChatInput() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [text, setText] = useState('');
  const [yoloConfirmOpen, setYoloConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // True while the leading '/' was injected by the toggle button (not typed by
  // the user). Escape strips that injected '/'; a user-typed '/' is kept.
  const slashFromToggleRef = useRef(false);

  // Config carries the model display name + thinking capability. Cached fetch.
  const ensureConfigLoaded = useKimiConfigStore((s) => s.ensureLoaded);
  const config = useKimiConfigStore((s) => s.config);
  useEffect(() => ensureConfigLoaded(), [ensureConfigLoaded]);

  const sessionModel = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.model ?? null,
  );
  const { label: modelLabel, alwaysThinking } = resolveModel(config, sessionModel);

  const session = useChatStore((s) => (sessionId ? s.sessions[sessionId] : null));
  const isTurnInProgress = session?.isTurnInProgress ?? false;
  const slashCommands =
    useChatStore((s) => (sessionId ? s.sessions[sessionId]?.slashCommands : null)) ?? [];

  // Approval mode + thinking mirror the true state from the snapshot (survive
  // reload). Changing them → optimistic store update + WS send; applied from the
  // next message onward (server respawns the CLI).
  const yoloMode = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.yoloMode ?? false) : false,
  );
  const thinking = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.thinking ?? false) : false,
  );
  // `always_thinking` models force thinking on regardless of the session flag.
  const effectiveThinking = alwaysThinking || thinking;

  const [highlightIdx, setHighlightIdx] = useState(0);

  const query = parseSlashQuery(text);

  // Filtered command groups: Commands, Skills, Modes (keep this order).
  const { groups, flatItems } = useMemo(() => {
    if (query === null) return { groups: [] as CommandGroup[], flatItems: [] as SlashCommand[] };
    const filtered = slashCommands
      .filter((c) => !EXCLUDED_COMMANDS.has(c.name))
      .filter((c) => matchesQuery(c, query))
      .sort((a, b) => matchRank(a, query) - matchRank(b, query));

    const skills: SlashCommand[] = [];
    const modes: SlashCommand[] = [];
    const commands: SlashCommand[] = [];
    for (const c of filtered) {
      if (c.name.startsWith('skill:')) skills.push(c);
      else if (MODE_COMMANDS.includes(c.name)) modes.push(c);
      else commands.push(c);
    }

    const built: CommandGroup[] = [];
    let offset = 0;
    const push = (label: string, items: SlashCommand[]) => {
      if (!items.length) return;
      built.push({ label, items, startIdx: offset });
      offset += items.length;
    };
    push('Commands', commands);
    push('Skills', skills);
    push('Modes', modes);

    return { groups: built, flatItems: built.flatMap((g) => g.items) };
  }, [query, slashCommands]);

  // Only show the picker when something matches — typing a path like
  // `/path/to/file` matches nothing, so it closes instead of lingering.
  const isPickerOpen = query !== null && !isTurnInProgress && flatItems.length > 0;

  // Keep highlight in range as the filtered list shrinks on each keystroke.
  useEffect(() => {
    if (highlightIdx >= flatItems.length) setHighlightIdx(0);
  }, [flatItems.length, highlightIdx]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 6 * 24;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const onChangeText = (value: string) => {
    setText(value);
    setHighlightIdx(0);
    // Once the picker is no longer active, the injected '/' is moot.
    if (parseSlashQuery(value) === null) slashFromToggleRef.current = false;
  };

  const selectCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.name} `);
    setHighlightIdx(0);
    slashFromToggleRef.current = false;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = 'auto';
    }
  };

  // Open the picker without clobbering a draft: prepend '/' so parseSlashQuery
  // matches. Already starts with '/' → just refocus (that '/' is the user's).
  const openSlashPicker = () => {
    if (!sessionId) return;
    setText((t) => {
      if (t.startsWith('/')) return t;
      slashFromToggleRef.current = true;
      return `/${t}`;
    });
    setHighlightIdx(0);
    textareaRef.current?.focus();
  };

  const stopTurn = () => {
    if (!sessionId) return;
    sendWS('interrupt_turn', {}, sessionId);
  };

  const sendMessage = () => {
    if (!text.trim() || !sessionId || isTurnInProgress) return;
    const content = text.trim();
    setText('');
    slashFromToggleRef.current = false;
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';

    useChatStore.getState().addPendingUserBlock(sessionId, content);
    // Composer flags ride along with the send — no separate message. The server
    // applies them just before spawning the turn and persists only real flips.
    sendWS('send_message', { content, thinking, yoloMode }, sessionId);
  };

  // Toggles only mutate local store state; the value is committed when the user
  // sends (it can't take effect before the next prompt anyway).
  const applyApprovalMode = (yolo: boolean) => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { yoloMode: yolo });
  };

  // Enabling YOLO is gated by a confirm dialog the first time per session.
  const setApprovalMode = (yolo: boolean) => {
    if (!sessionId) return;
    if (yolo && !yoloMode && !yoloAcknowledged.has(sessionId)) {
      setYoloConfirmOpen(true);
      return;
    }
    applyApprovalMode(yolo);
  };

  const confirmYolo = () => {
    if (sessionId) yoloAcknowledged.add(sessionId);
    setYoloConfirmOpen(false);
    applyApprovalMode(true);
  };

  const toggleThinking = () => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { thinking: !thinking });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isPickerOpen) {
      if (flatItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightIdx((i) => (i + 1) % flatItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightIdx((i) => (i - 1 + flatItems.length) % flatItems.length);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const cmd = flatItems[highlightIdx];
          if (cmd) selectCommand(cmd);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (slashFromToggleRef.current) {
          // The leading '/' was injected by the toggle: strip it, keeping only
          // what the user typed (empty → fully cleared).
          setText((t) => (t.startsWith('/') ? t.slice(1) : t));
          slashFromToggleRef.current = false;
        } else {
          // User typed '/': keep it, just close the picker by ending the query
          // with a space so parseSlashQuery returns null.
          setText((t) => (t.includes(' ') ? t : `${t} `));
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isTurnInProgress) {
        // Future: steer (send-now) vs queue. For now Enter is no-op while a turn runs.
        return;
      }
      sendMessage();
    }
  };

  const handlePrimaryAction = () => {
    if (isTurnInProgress) {
      stopTurn();
      return;
    }
    sendMessage();
  };

  const placeholderText = !sessionId
    ? 'Select or create a project to start...'
    : isTurnInProgress
      ? 'Agent is running — press Stop to halt'
      : 'Ask anything...';

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-4 md:px-4 md:pb-6 shrink-0">
      <div
        className={`relative rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-1 focus-within:ring-ring ${
          isTurnInProgress ? 'border-primary/30' : 'border-border'
        }`}
      >
        {isPickerOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-30">
            <div className="rounded-lg border border-border/70 bg-popover/95 backdrop-blur supports-[backdrop-filter]:bg-popover/85 shadow-lg max-h-72 overflow-y-auto py-1">
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none">
                    {group.label}
                  </div>
                  {group.items.map((cmd, i) => {
                    const idx = group.startIdx + i;
                    const active = idx === highlightIdx;
                    return (
                      <button
                        key={cmd.name}
                        type="button"
                        onMouseEnter={() => setHighlightIdx(idx)}
                        onClick={() => selectCommand(cmd)}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left ${
                          active ? 'bg-accent text-accent-foreground' : 'text-foreground'
                        }`}
                      >
                        <span className="text-sm font-mono">/{cmd.name}</span>
                        {cmd.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {cmd.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={!sessionId}
          aria-label="Chat input"
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
          style={{ minHeight: '44px', maxHeight: '144px' }}
        />

        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* Thinking status badge — display only; toggle lives in the model menu. */}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={openSlashPicker}
              disabled={!sessionId}
              aria-label="Slash commands"
              title="Slash commands"
              className="font-mono text-muted-foreground cursor-pointer"
            >
              <Slash className="h-3.5 w-3.5" />
            </Button>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium select-none ${
                effectiveThinking ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}
              title="Thinking status — change it in the model menu"
            >
              <Brain className="h-3.5 w-3.5" />
              {effectiveThinking ? 'Thinking on' : 'Thinking off'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu
              align="end"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground cursor-pointer"
                  disabled={!sessionId}
                  aria-label="Model"
                  title="Model — applies from the next message"
                >
                  <Brain className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{modelLabel ?? 'Model'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none">
                {modelLabel ?? 'Model'}
              </div>
              <DropdownItem
                onClick={alwaysThinking ? undefined : toggleThinking}
                disabled={alwaysThinking}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Brain className="h-3.5 w-3.5" />
                    Thinking
                  </span>
                  {alwaysThinking ? (
                    <span className="text-xs text-muted-foreground">Always on</span>
                  ) : (
                    <Switch on={effectiveThinking} />
                  )}
                </span>
              </DropdownItem>
            </DropdownMenu>

            <DropdownMenu
              align="end"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={`cursor-pointer ${yoloMode ? 'text-amber-500' : 'text-muted-foreground'}`}
                  disabled={!sessionId}
                  aria-label="Approval mode"
                  title="Approval mode — applies from the next message"
                >
                  {yoloMode ? (
                    <Zap className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{yoloMode ? 'YOLO' : 'Normal'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none">
                Applies from the next message
              </div>
              <DropdownItem
                onClick={() => setApprovalMode(false)}
                icon={<Check className={yoloMode ? 'opacity-0' : ''} />}
              >
                <span className="flex flex-col">
                  <span>Normal</span>
                  <span className="text-xs text-muted-foreground">
                    Approve each tool before it runs
                  </span>
                </span>
              </DropdownItem>
              <DropdownItem
                onClick={() => setApprovalMode(true)}
                icon={<Check className={yoloMode ? '' : 'opacity-0'} />}
              >
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5">
                    YOLO
                    <Zap className="h-3 w-3 text-amber-500" />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Run every tool without asking
                  </span>
                </span>
              </DropdownItem>
            </DropdownMenu>

            {isTurnInProgress ? (
              <Button
                type="button"
                size="icon-sm"
                variant="destructive"
                onClick={handlePrimaryAction}
                disabled={!sessionId}
                aria-label="Stop turn"
                title="Stop the running agent"
                className="cursor-pointer"
              >
                <Square />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                onClick={handlePrimaryAction}
                disabled={!text.trim() || !sessionId}
                aria-label="Send message"
                className="cursor-pointer"
              >
                <Send />
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmYoloDialog
        isOpen={yoloConfirmOpen}
        onConfirm={confirmYolo}
        onClose={() => setYoloConfirmOpen(false)}
      />
    </div>
  );
}
