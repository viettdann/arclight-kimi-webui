import { Brain, Check, ChevronDown, Gauge, Send, ShieldCheck, Square, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  BUILTIN_COMMANDS,
  type CommandInfo,
  classifyCommand,
  parseSlashCommand,
} from 'shared/commands';
import { type ApprovalMode, EFFORT_LEVELS, type EffortLevel } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu, DropdownSeparator } from '@/components/ui/dropdown-menu';
import { useChatStore } from '../lib/chat-store';
import { useCommandStore } from '../lib/command-store';
import { useDraftStore } from '../lib/draft-store';
import { isResolvable, labelFor, useProvidersStore } from '../lib/providers-store';
import { useSessionsStore } from '../lib/sessions-store';
import { sendWS } from '../lib/ws-send';
import { ConfirmBypassDialog } from './confirm-bypass-dialog';
import { SlashCommandMenu } from './slash-command-menu';
import { showToast } from './toast-provider';

// Sessions where the user has acknowledged the bypass-permissions warning.
// Switching to bypass confirms once per session (per app load); switching away
// never prompts.
const bypassAcknowledged = new Set<string>();

// On coarse-pointer devices (phones/tablets) the soft keyboard's Enter is the
// only newline key, so plain Enter must insert a newline — sending is done via
// the Send button or Ctrl/Cmd+Enter. On fine-pointer devices (desktop) plain
// Enter sends. Evaluated once: pointer type doesn't change within a session.
const ENTER_INSERTS_NEWLINE =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

// Picker opens only on a bare leading-slash token (no whitespace, no args). The
// capture group is the filter. Any space/newline closes it — the user is typing
// arguments.
const SLASH_PICKER_RE = /^\/([\w-]*)$/;

const effortLabel = (value: EffortLevel) => value.charAt(0).toUpperCase() + value.slice(1);

// Effort selector options. `null` renders as "Default" (provider default); the
// rest derive from EFFORT_LEVELS so the picker never drifts from the wire type.
const EFFORT_OPTIONS: { value: EffortLevel | null; label: string }[] = [
  { value: null, label: 'Default' },
  ...EFFORT_LEVELS.map((value) => ({ value, label: effortLabel(value) })),
];

// Group order for the picker: Commands (builtin, then project) before Skills.
const KIND_ORDER: Record<CommandInfo['kind'], number> = { builtin: 0, project: 1, skill: 2 };

// Stable empty-array reference for the command selector. Returning a fresh `[]`
// literal from a zustand selector makes every snapshot compare unequal, which
// drives an infinite render loop ("getSnapshot should be cached").
const NO_COMMANDS: CommandInfo[] = [];

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
  // Draft text lives in a per-session store (persisted to localStorage), not in
  // local component state: switching sessions must show the target session's
  // draft (or empty), and a reload must not lose what was typed. `text`/`setText`
  // are thin adapters over the store so the rest of the component is unchanged.
  const text = useDraftStore((s) => (sessionId ? (s.drafts[sessionId] ?? '') : ''));
  const setText = useCallback(
    (value: string | ((prev: string) => string)) => {
      if (!sessionId) return;
      const prev = useDraftStore.getState().drafts[sessionId] ?? '';
      const next = typeof value === 'function' ? value(prev) : value;
      useDraftStore.getState().setDraft(sessionId, next);
    },
    [sessionId],
  );
  const [bypassConfirmOpen, setBypassConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load available providers catalog on mount.
  const { available, status, error, ensureLoaded, load } = useProvidersStore();
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    ensureLoaded();
  }, []);

  // Read the session's providerId + model from sessions store.
  const sessionEntry = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId) ?? null);
  const sessionProviderId = sessionEntry?.providerId ?? null;
  const sessionModel = sessionEntry?.model ?? null;

  // Model picks are local UI state until the user sends (mirrors thinking/approval):
  // the chosen (providerId, modelId) pair rides along with the next `send_message`.
  // null → fall back to session values.
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Effective selection — local override wins, else session values.
  const effectiveProviderId = selectedProviderId ?? sessionProviderId;
  const effectiveModel = selectedModel ?? sessionModel;

  // A selection is "orphaned" when it points at a provider/model that no longer
  // exists in the catalog (provider deleted or hidden). Only meaningful once the
  // catalog is ready; while loading we don't yet know whether it resolves.
  const hasSelection = Boolean(effectiveProviderId && effectiveModel);
  const isUnresolvable =
    status === 'ready' &&
    hasSelection &&
    !isResolvable(available, effectiveProviderId, effectiveModel);

  // Human-readable label for the current selection. An orphaned selection shows
  // a reselect prompt; otherwise the resolved label or the empty-state prompt.
  const modelLabel = isUnresolvable
    ? 'Unavailable — reselect'
    : (labelFor(available, effectiveProviderId, effectiveModel) ?? 'Select a model');

  // Catalog loaded but both scopes are empty: nothing to send with, so block the
  // composer until a provider exists.
  const noModelsAvailable =
    status === 'ready' &&
    (available?.builtin.length ?? 0) === 0 &&
    (available?.personal.length ?? 0) === 0;

  const session = useChatStore((s) => (sessionId ? s.sessions[sessionId] : null));
  const isTurnInProgress = session?.isTurnInProgress ?? false;

  // Approval mode + thinking mirror the true state from the snapshot (survive
  // reload). Changing them → optimistic store update + WS send; applied from the
  // next message onward (server respawns the CLI).
  const approvalMode = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.approvalMode ?? 'ask') : 'ask',
  );
  const thinking = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.thinking ?? false) : false,
  );
  // Reasoning effort mirrors the snapshot; `null` is the provider default.
  const effort = useChatStore((s) => (sessionId ? (s.sessions[sessionId]?.effort ?? null) : null));

  // Slash-command picker state. `activeIndex` is the keyboard cursor into the
  // filtered `items`; `pickerDismissed` is set by Esc and reset when the text
  // stops matching the slash pattern (see the effect below).
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);

  // Dynamic catalog the live session reported (commands + skills).
  const dynamicCommands = useCommandStore((s) =>
    sessionId ? (s.commandsBySession[sessionId] ?? NO_COMMANDS) : NO_COMMANDS,
  );

  // Merge built-ins with the dynamic catalog, deduped by name (builtin wins),
  // then order by group (commands before skills). This is the full catalog used
  // for classify-on-send; the picker filters it further.
  const mergedCatalog = useMemo(() => {
    const byName = new Map<string, CommandInfo>();
    for (const cmd of dynamicCommands) byName.set(cmd.name, cmd);
    // Built-ins win on name collision.
    for (const cmd of BUILTIN_COMMANDS) byName.set(cmd.name, cmd);
    return [...byName.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }, [dynamicCommands]);

  // Derive the picker open state + filter from the current text.
  const slashMatch = SLASH_PICKER_RE.exec(text);
  const pickerFilter = slashMatch?.[1] ?? '';

  const slashOpen = Boolean(slashMatch);

  // Filtered, ordered list shown in the picker (and the index space for
  // `activeIndex`). Names that start with the filter rank before mere includes.
  const pickerItems = useMemo(() => {
    if (!slashOpen) return [];
    const f = pickerFilter.toLowerCase();
    const matched = mergedCatalog.filter((c) => c.name.toLowerCase().includes(f));
    return matched.sort((a, b) => {
      const groupDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (groupDiff !== 0) return groupDiff;
      const aStarts = a.name.toLowerCase().startsWith(f) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(f) ? 0 : 1;
      return aStarts - bStarts;
    });
  }, [slashOpen, pickerFilter, mergedCatalog]);

  const pickerOpen = slashOpen && !pickerDismissed && pickerItems.length > 0;

  // Reset the keyboard cursor + dismissed flag whenever the text no longer
  // matches the slash pattern (or a fresh slash is typed). `pickerFilter` is a
  // trigger only — a new filter restarts the cursor at the top of the new list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pickerFilter is an intentional trigger, not read in the body.
  useEffect(() => {
    if (!slashOpen) setPickerDismissed(false);
    setActiveIndex(0);
  }, [slashOpen, pickerFilter]);

  // Switching sessions drops the pending model override so each session shows its
  // own model (or the default) rather than a leftover pick from a prior session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on sessionId only.
  useEffect(() => {
    setSelectedProviderId(null);
    setSelectedModel(null);
  }, [sessionId]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 6 * 24;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  // `onInput` only fires on typing, so resize whenever `text` changes from
  // elsewhere — switching sessions or restoring a persisted draft on load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger; `handleInput` is stable.
  useEffect(() => {
    handleInput();
  }, [text]);

  const stopTurn = () => {
    if (!sessionId) return;
    sendWS('interrupt_turn', {}, sessionId);
  };

  const sendMessage = () => {
    if (!text.trim() || !sessionId || isTurnInProgress) return;
    if (noModelsAvailable) {
      showToast({ message: 'No model available — configure a provider first', type: 'error' });
      return;
    }
    const content = text.trim();

    // Classify slash-commands before sending. An unsupported command never
    // reaches the CLI — surface the replacement hint and leave the draft intact
    // so the user can edit it.
    if (content.startsWith('/')) {
      const parsed = parseSlashCommand(content);
      if (parsed) {
        const result = classifyCommand(parsed.name, {
          dynamic: mergedCatalog.map((c) => c.name),
        });
        if (result.type === 'unsupported') {
          showToast({ message: result.hint, type: 'error' });
          return;
        }
      }
    }

    setText('');
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';

    useChatStore.getState().addPendingUserBlock(sessionId, content);
    // Composer flags ride along with the send — no separate message. The server
    // applies them just before spawning the turn and persists only real flips.
    // Both model and providerId are included when the user made an override pick;
    // omitting them leaves the session's current selection unchanged.
    //
    // When the current selection is orphaned (provider deleted/hidden) we omit
    // both fields so the server falls back to its default rather than respawning
    // against a provider that no longer exists.
    sendWS(
      'send_message',
      {
        content,
        thinking,
        approvalMode,
        effort,
        model: isUnresolvable ? undefined : (effectiveModel ?? undefined),
        providerId: isUnresolvable ? undefined : (effectiveProviderId ?? undefined),
      },
      sessionId,
    );
  };

  // Toggles only mutate local store state; the value is committed when the user
  // sends (it can't take effect before the next prompt anyway).
  const applyApprovalMode = (mode: ApprovalMode) => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { approvalMode: mode });
  };

  // Switching to bypass is gated by a confirm dialog the first time per session.
  // ask / safe apply immediately.
  const setApprovalMode = (mode: ApprovalMode) => {
    if (!sessionId) return;
    if (mode === 'bypass' && approvalMode !== 'bypass' && !bypassAcknowledged.has(sessionId)) {
      setBypassConfirmOpen(true);
      return;
    }
    applyApprovalMode(mode);
  };

  const confirmBypass = () => {
    if (sessionId) bypassAcknowledged.add(sessionId);
    setBypassConfirmOpen(false);
    applyApprovalMode('bypass');
  };

  const toggleThinking = () => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { thinking: !thinking });
  };

  const setEffort = (next: EffortLevel | null) => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { effort: next });
  };

  // Pick a command from the picker: rewrite the composer to `/name ` and place
  // the caret at the end. The trailing space closes the picker (no longer
  // matches the regex) and positions the user to type arguments.
  const selectCommand = (cmd: CommandInfo) => {
    setText(`/${cmd.name} `);
    setPickerDismissed(false);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      // Defer caret move until the controlled value has flushed to the DOM.
      requestAnimationFrame(() => {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the picker is open it owns navigation/selection keys. Send is
    // suppressed; Enter/Tab select, arrows move, Esc dismisses.
    if (pickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % pickerItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + pickerItems.length) % pickerItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = pickerItems[activeIndex];
        if (cmd) selectCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter') {
      // Ctrl/Cmd+Enter always sends. Plain Enter sends only on fine-pointer
      // devices; on touch it falls through to insert a newline. Shift+Enter and
      // any other modifier combo always insert a newline.
      const modifierSend = e.ctrlKey || e.metaKey;
      const plainSend =
        !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !ENTER_INSERTS_NEWLINE;
      if (modifierSend || plainSend) {
        e.preventDefault();
        // Enter is a no-op while a turn is running.
        if (isTurnInProgress) return;
        sendMessage();
      }
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
    : noModelsAvailable
      ? 'No models available — configure a provider to start'
      : isTurnInProgress
        ? 'Agent is running — press Stop to halt'
        : 'Ask anything...';

  // Build flat model lists for dropdown.
  const builtinProviders = available?.builtin ?? [];
  const personalProviders = available?.personal ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-4 md:px-4 md:pb-6 shrink-0 bg-transparent">
      <div
        className={`relative rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-1 focus-within:ring-ring ${
          isTurnInProgress ? 'border-primary/30' : 'border-border'
        }`}
      >
        {pickerOpen && (
          <SlashCommandMenu
            items={pickerItems}
            activeIndex={activeIndex}
            filter={pickerFilter}
            onSelect={selectCommand}
            onHover={setActiveIndex}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={!sessionId || noModelsAvailable}
          aria-label="Chat input"
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
          style={{ minHeight: '44px', maxHeight: '144px' }}
        />

        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* Reasoning — Thinking toggle + reasoning effort, grouped together. */}
          <DropdownMenu
            align="start"
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={`cursor-pointer ${thinking ? 'text-primary' : 'text-muted-foreground'}`}
                disabled={!sessionId}
                aria-label="Reasoning"
                title="Thinking & reasoning effort — applies from the next message"
              >
                <Brain className="h-3.5 w-3.5" />
                <span>
                  {thinking ? 'Thinking' : 'Thinking off'}
                  {thinking && effort ? ` · ${effortLabel(effort)}` : ''}
                </span>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none">
              Applies from the next message
            </div>

            <DropdownItem
              onClick={toggleThinking}
              closeOnClick={false}
              trailing={<Switch on={thinking} />}
            >
              <span className="flex items-center gap-2">
                <Brain className="h-3.5 w-3.5" />
                Thinking
              </span>
            </DropdownItem>

            <DropdownSeparator />

            {/* Effort only applies under extended thinking; dim + disable when off. */}
            <div
              className={`flex items-center gap-2 px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider select-none ${
                thinking ? 'text-muted-foreground' : 'text-muted-foreground/40'
              }`}
            >
              <Gauge className="h-3 w-3" />
              Effort
            </div>
            {EFFORT_OPTIONS.map((opt) => (
              <DropdownItem
                key={opt.label}
                disabled={!thinking}
                onClick={() => setEffort(opt.value)}
                icon={<Check className={thinking && effort === opt.value ? '' : 'opacity-0'} />}
              >
                <span>{opt.label}</span>
              </DropdownItem>
            ))}
          </DropdownMenu>

          <div className="flex items-center gap-2">
            <DropdownMenu
              align="end"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={`cursor-pointer ${approvalMode === 'bypass' ? 'text-amber-500' : 'text-muted-foreground'}`}
                  disabled={!sessionId}
                  aria-label="Approval mode"
                  title="Approval mode — applies from the next message"
                >
                  {approvalMode === 'bypass' ? (
                    <Zap className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldCheck
                      className={`h-3.5 w-3.5 ${approvalMode === 'safe' ? 'text-primary' : ''}`}
                    />
                  )}
                  <span className="hidden sm:inline">
                    {approvalMode === 'bypass'
                      ? 'Bypass'
                      : approvalMode === 'safe'
                        ? 'Safe'
                        : 'Ask first'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none">
                Applies from the next message
              </div>
              <DropdownItem
                onClick={() => setApprovalMode('ask')}
                icon={<Check className={approvalMode === 'ask' ? '' : 'opacity-0'} />}
              >
                <span className="flex flex-col">
                  <span>Ask first</span>
                  <span className="text-xs text-muted-foreground">
                    Approve each tool before it runs
                  </span>
                </span>
              </DropdownItem>
              <DropdownItem
                onClick={() => setApprovalMode('safe')}
                icon={<Check className={approvalMode === 'safe' ? '' : 'opacity-0'} />}
              >
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5">
                    Safe · pre-approved tools
                    <ShieldCheck className="h-3 w-3 text-primary" />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Auto-approve read-only tools, ask for the rest
                  </span>
                </span>
              </DropdownItem>
              <DropdownItem
                onClick={() => setApprovalMode('bypass')}
                icon={<Check className={approvalMode === 'bypass' ? '' : 'opacity-0'} />}
              >
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5">
                    Bypass · YOLO
                    <Zap className="h-3 w-3 text-amber-500" />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Run every tool without asking
                  </span>
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
                  className={`cursor-pointer ${isUnresolvable ? 'text-amber-500' : 'text-muted-foreground'}`}
                  disabled={!sessionId}
                  aria-label="Model"
                  title={
                    isUnresolvable
                      ? 'The selected model is no longer available — pick another'
                      : 'Model — applies from the next message'
                  }
                >
                  <span className="max-w-[16ch] truncate">{modelLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none truncate max-w-[20ch]">
                {modelLabel}
              </div>

              {builtinProviders.length > 0 && (
                <>
                  <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                    Built-in
                  </div>
                  {builtinProviders.flatMap((provider) =>
                    provider.models.map((m) => {
                      const isActive =
                        effectiveProviderId === provider.id && effectiveModel === m.modelId;
                      return (
                        <DropdownItem
                          key={`${provider.id}/${m.modelId}`}
                          onClick={() => {
                            setSelectedProviderId(provider.id);
                            setSelectedModel(m.modelId);
                          }}
                          icon={<Check className={isActive ? '' : 'opacity-0'} />}
                        >
                          <span>{`${provider.namespace}/${m.displayName ?? m.modelId}`}</span>
                        </DropdownItem>
                      );
                    }),
                  )}
                </>
              )}

              {personalProviders.length > 0 && (
                <>
                  <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                    Personal
                  </div>
                  {personalProviders.flatMap((provider) =>
                    provider.models.map((m) => {
                      const isActive =
                        effectiveProviderId === provider.id && effectiveModel === m.modelId;
                      return (
                        <DropdownItem
                          key={`${provider.id}/${m.modelId}`}
                          onClick={() => {
                            setSelectedProviderId(provider.id);
                            setSelectedModel(m.modelId);
                          }}
                          icon={<Check className={isActive ? '' : 'opacity-0'} />}
                        >
                          <span>{`${provider.namespace}/${m.displayName ?? m.modelId}`}</span>
                        </DropdownItem>
                      );
                    }),
                  )}
                </>
              )}

              {status === 'loading' && (
                <div className="px-2 py-2 text-xs text-muted-foreground select-none">
                  Loading providers…
                </div>
              )}

              {status === 'error' && (
                <DropdownItem onClick={() => void load()}>
                  <span className="flex flex-col">
                    <span className="text-amber-500">Failed to load — retry</span>
                    {error && (
                      <span className="text-xs text-muted-foreground truncate">{error}</span>
                    )}
                  </span>
                </DropdownItem>
              )}

              {status === 'ready' &&
                builtinProviders.length === 0 &&
                personalProviders.length === 0 && (
                  <div className="px-2 py-2 text-xs text-muted-foreground select-none">
                    No providers configured
                  </div>
                )}
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
                disabled={!text.trim() || !sessionId || noModelsAvailable}
                aria-label="Send message"
                className="cursor-pointer"
              >
                <Send />
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmBypassDialog
        isOpen={bypassConfirmOpen}
        onConfirm={confirmBypass}
        onClose={() => setBypassConfirmOpen(false)}
      />
    </div>
  );
}
