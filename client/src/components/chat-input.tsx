import {
  Brain,
  Check,
  ChevronDown,
  CornerDownLeft,
  FolderGit2,
  Gauge,
  Rocket,
  ShieldCheck,
  Square,
  SquareSlash,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  BUILTIN_COMMANDS,
  type CommandInfo,
  classifyCommand,
  parseSlashCommand,
} from 'shared/commands';
import {
  type ApprovalMode,
  EFFORT_OPTIONS,
  type EffortLevel,
  effortLabel,
  effortPill,
} from 'shared/types';
import type { ProviderDTO } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownSubmenu,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '../lib/auth-store';
import { useChatStore } from '../lib/chat-store';
import { useCommandStore } from '../lib/command-store';
import { useDraftStore } from '../lib/draft-store';
import { useProjectLaunchStore } from '../lib/project-launch-store';
import { isResolvable, labelFor, useProvidersStore } from '../lib/providers-store';
import { DRAFT_WORKDIR_PARAM } from '../lib/router';
import { useSessionDefaultsStore, withSilentSave } from '../lib/session-defaults-store';
import { useSessionsStore } from '../lib/sessions-store';
import { useUserSkillsStore } from '../lib/user-skills-store';
import { sendWS } from '../lib/ws-send';
import { ConfirmBypassDialog } from './confirm-bypass-dialog';
import { SlashCommandMenu } from './slash-command-menu';
import { showToast } from './toast-provider';

// Bypass-warning acknowledgements, keyed by session id or draft workDir.
// Confirm fires once per composer per app load; switching away never prompts.
const bypassAcknowledged = new Set<string>();

// Coarse pointers (touch) have no dedicated newline key, so plain Enter inserts
// a newline and sending falls to the Send button or Ctrl/Cmd+Enter. Evaluated
// once: pointer type is stable within a session.
const ENTER_INSERTS_NEWLINE =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

// Picker opens only on a bare leading-slash token; the capture group is the
// filter. Any space/newline closes it (the user is typing arguments).
const SLASH_PICKER_RE = /^\/([\w-]*)$/;

// Shared by the send-blocked toast and the Model tooltip so the wording can't drift.
const MSG_MODEL_UNRESOLVABLE = 'The selected model is no longer available — pick another';
const MSG_SELECT_MODEL = 'Select a model before sending';

const KIND_ORDER: Record<CommandInfo['kind'], number> = { builtin: 0, project: 1, skill: 2 };

// Stable ref: a fresh `[]` from a zustand selector compares unequal every
// snapshot, triggering an infinite render loop ("getSnapshot should be cached").
const NO_COMMANDS: CommandInfo[] = [];

function Switch({ on, tone = 'primary' }: { on: boolean; tone?: 'primary' | 'ultracode' }) {
  return (
    <span
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
        on ? (tone === 'ultracode' ? 'bg-ultracode' : 'bg-primary') : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-primary-foreground shadow-sm transition-transform ${
          on ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </span>
  );
}

// One labeled group (Built-in or Personal) in the model dropdown: a header plus
// every provider's models, with a check on the active pick. Both scopes render
// identically, so the markup lives here once.
function ModelProviderSection({
  label,
  providers,
  effectiveProviderId,
  effectiveModel,
  onSelect,
}: {
  label: string;
  providers: ProviderDTO[];
  effectiveProviderId: string | null;
  effectiveModel: string | null;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  if (providers.length === 0) return null;
  return (
    <>
      <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
        {label}
      </div>
      {providers.flatMap((provider) =>
        provider.models.map((m) => {
          const isActive = effectiveProviderId === provider.id && effectiveModel === m.modelId;
          return (
            <DropdownItem
              key={`${provider.id}/${m.modelId}`}
              onClick={() => onSelect(provider.id, m.modelId)}
              icon={<Check className={isActive ? '' : 'opacity-0'} />}
            >
              <span>{`${provider.namespace}/${m.displayName ?? m.modelId}`}</span>
            </DropdownItem>
          );
        }),
      )}
    </>
  );
}

export function ChatInput() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // Draft route `/session/new?workDir=…`: no id but a workDir. Its composer
  // sends `start_session` (create + first turn) rather than `send_message`.
  const draftWorkDir = sessionId ? null : searchParams.get(DRAFT_WORKDIR_PARAM);
  const isDraft = !sessionId && draftWorkDir != null;
  const canCompose = Boolean(sessionId) || isDraft;
  // Welcome/landing: no session and no draft yet. Shows a "Select Project"
  // control that routes to the draft route and unlocks composing.
  const isWelcome = !sessionId && !isDraft;
  const authStatus = useAuthStore((s) => s.status);
  const launchNewTask = useProjectLaunchStore((s) => s.launch);
  const selectProject = useCallback(() => {
    if (authStatus !== 'authenticated') return;
    launchNewTask();
  }, [authStatus, launchNewTask]);
  // Persisted-draft key: session id once one exists, else a workDir-scoped key
  // so a reload of the draft route restores the text.
  const draftKey = sessionId ?? (draftWorkDir ? `new:${draftWorkDir}` : null);

  // Draft text lives in a per-key localStorage store, not component state, so
  // switching sessions shows the target's draft and a reload doesn't lose it.
  // `text`/`setText` are thin adapters over the store.
  const text = useDraftStore((s) => (draftKey ? (s.drafts[draftKey] ?? '') : ''));
  const setText = useCallback(
    (value: string | ((prev: string) => string)) => {
      if (!draftKey) return;
      const prev = useDraftStore.getState().drafts[draftKey] ?? '';
      const next = typeof value === 'function' ? value(prev) : value;
      useDraftStore.getState().setDraft(draftKey, next);
    },
    [draftKey],
  );
  const [bypassConfirmOpen, setBypassConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { available, status, error, ensureLoaded, load } = useProvidersStore();
  // Load the providers catalog + session defaults on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    ensureLoaded();
    useUserSkillsStore.getState().ensureLoaded();
    const defaults = useSessionDefaultsStore.getState();
    if (defaults.status === 'idle') void defaults.load();
  }, []);

  const sessionEntry = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId) ?? null);
  const sessionProviderId = sessionEntry?.providerId ?? null;
  const sessionModel = sessionEntry?.model ?? null;

  // Local override until the user sends; the (providerId, modelId) pair rides
  // along with the next send. null → fall back to session values.
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Catalog ready but both scopes empty: block the composer until a provider exists.
  const noModelsAvailable =
    status === 'ready' &&
    (available?.builtin.length ?? 0) === 0 &&
    (available?.personal.length ?? 0) === 0;

  const session = useChatStore((s) => (sessionId ? s.sessions[sessionId] : null));
  const isTurnInProgress = session?.isTurnInProgress ?? false;

  // Draft-mode composer flags: a draft has no session to mirror, so the toggles
  // seed once (lazy init) from Session Defaults and ride along with
  // `start_session`. Lazy, not reactive — a subscription would re-render on any
  // global-defaults change for no benefit.
  const [draftApprovalMode, setDraftApprovalMode] = useState<ApprovalMode>(
    () => useSessionDefaultsStore.getState().approvalMode,
  );
  const [draftThinking, setDraftThinking] = useState<boolean>(
    () => useSessionDefaultsStore.getState().thinking,
  );
  const [draftUltracode, setDraftUltracode] = useState<boolean>(
    () => useSessionDefaultsStore.getState().ultracode,
  );
  const [draftEffort, setDraftEffort] = useState<EffortLevel | null>(
    () => useSessionDefaultsStore.getState().effort,
  );
  const [draftProviderId, setDraftProviderId] = useState<string | null>(
    () => useSessionDefaultsStore.getState().providerId,
  );
  const [draftModel, setDraftModel] = useState<string | null>(
    () => useSessionDefaultsStore.getState().model,
  );

  // Effective selection — local override wins, else draft defaults, else session values.
  const effectiveProviderId = selectedProviderId ?? draftProviderId ?? sessionProviderId;
  const effectiveModel = selectedModel ?? draftModel ?? sessionModel;

  // "Orphaned": the selection points at a provider/model no longer in the
  // catalog (deleted or hidden). Only knowable once the catalog is ready.
  const hasSelection = Boolean(effectiveProviderId && effectiveModel);
  const isUnresolvable =
    status === 'ready' &&
    hasSelection &&
    !isResolvable(available, effectiveProviderId, effectiveModel);

  // `modelLabel` keeps the `namespace/model` form (desktop); `modelLabelCompact`
  // drops the namespace so the pill stays short on narrow viewports.
  const modelLabel = isUnresolvable
    ? 'Unavailable — reselect'
    : (labelFor(available, effectiveProviderId, effectiveModel) ?? 'Select a model');
  const modelLabelCompact = isUnresolvable
    ? 'Unavailable'
    : (labelFor(available, effectiveProviderId, effectiveModel, true) ?? 'Select a model');

  // No usable (providerId, model): block the send and steer to the model picker.
  // Distinct from `noModelsAvailable` so the prompt says "pick a model", not
  // "configure a provider".
  const needsSelection =
    status === 'ready' && !noModelsAvailable && (!hasSelection || isUnresolvable);

  // Approval/thinking/effort mirror the session snapshot (survive reload) and
  // apply from the next message on; in a draft they come from local draft state.
  const sessionApprovalMode = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.approvalMode ?? 'ask') : 'ask',
  );
  const sessionThinking = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.thinking ?? false) : false,
  );
  const sessionUltracode = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.ultracode ?? false) : false,
  );
  // `null` effort is the provider default.
  const sessionEffort = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.effort ?? null) : null,
  );
  const approvalMode = isDraft ? draftApprovalMode : sessionApprovalMode;
  const thinking = isDraft ? draftThinking : sessionThinking;
  const ultracode = isDraft ? draftUltracode : sessionUltracode;
  const effort = isDraft ? draftEffort : sessionEffort;

  // Picker state: `activeIndex` is the keyboard cursor; `pickerDismissed` is set
  // by Esc and reset when the text stops matching the slash pattern.
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);

  // Commands + skills the live session reported.
  const dynamicCommands = useCommandStore((s) =>
    sessionId ? (s.commandsBySession[sessionId] ?? NO_COMMANDS) : NO_COMMANDS,
  );

  // The user's enabled skills, preloaded from the DB so the picker lists `/skill`
  // commands before the first turn spawns a subprocess. The live catalog above
  // overrides these by name once it arrives.
  const userSkills = useUserSkillsStore((s) => s.skills);

  // Whether the live session has actually reported its catalog yet. Until it has
  // (cold start, or a resumed chat whose subprocess hasn't re-emitted
  // `system/init` after a server restart — the catalog is in-memory only),
  // classify-on-send must not hard-block unknown `/skill` names: forward them so
  // the CLI can resolve them. `?? NO_COMMANDS` above erases the undefined, so read
  // the raw entry here.
  const catalogKnown = useCommandStore((s) =>
    sessionId ? s.commandsBySession[sessionId] !== undefined : false,
  );

  // Full catalog for classify-on-send (the picker filters it further): dynamic
  // commands + built-ins, deduped by name (builtin wins), ordered by group.
  const mergedCatalog = useMemo(() => {
    const byName = new Map<string, CommandInfo>();
    // Weakest layer first: preloaded skills are overridden by the live session's
    // catalog (real metadata) and then built-ins, both keyed by name.
    for (const cmd of userSkills) byName.set(cmd.name, cmd);
    for (const cmd of dynamicCommands) byName.set(cmd.name, cmd);
    for (const cmd of BUILTIN_COMMANDS) byName.set(cmd.name, cmd);
    return [...byName.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }, [dynamicCommands, userSkills]);

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

  // Reset the cursor + dismissed flag when the slash match changes (closed, or a
  // fresh filter). `pickerFilter` is a trigger only, restarting the cursor at top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pickerFilter is an intentional trigger, not read in the body.
  useEffect(() => {
    if (!slashOpen) setPickerDismissed(false);
    setActiveIndex(0);
  }, [slashOpen, pickerFilter]);

  // Switching composer drops the pending model override (so each shows its own
  // model) and re-seeds draft flags from Session Defaults.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on the composer (draftKey) only; default seeds are read once per reset.
  useEffect(() => {
    setSelectedProviderId(null);
    setSelectedModel(null);
    const defaults = useSessionDefaultsStore.getState();
    setDraftApprovalMode(defaults.approvalMode);
    setDraftThinking(defaults.thinking);
    setDraftUltracode(defaults.ultracode);
    setDraftEffort(defaults.effort);
    setDraftProviderId(defaults.providerId);
    setDraftModel(defaults.model);
  }, [draftKey]);

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
    if (!text.trim() || !canCompose || isTurnInProgress) return;
    if (noModelsAvailable) {
      showToast({ message: 'No model available — configure a provider first', type: 'error' });
      return;
    }
    if (needsSelection) {
      showToast({
        message: isUnresolvable ? MSG_MODEL_UNRESOLVABLE : MSG_SELECT_MODEL,
        type: 'error',
      });
      return;
    }
    const content = text.trim();

    // An unsupported slash-command never reaches the CLI: show the hint and
    // leave the draft intact to edit.
    if (content.startsWith('/')) {
      const parsed = parseSlashCommand(content);
      if (parsed) {
        const result = classifyCommand(
          parsed.name,
          catalogKnown ? { dynamic: mergedCatalog.map((c) => c.name) } : {},
        );
        if (result.type === 'unsupported') {
          showToast({ message: result.hint, type: 'error' });
          return;
        }
      }
    }

    setText('');
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';

    // Composer flags ride along with the send; the server applies them before
    // spawning the turn. An orphaned selection omits model/providerId so the
    // server falls back rather than respawning against a vanished provider.
    // Shared by both sends so a new flag is added in one place.
    const flags = {
      content,
      thinking,
      ultracode,
      approvalMode,
      effort,
      model: isUnresolvable ? undefined : (effectiveModel ?? undefined),
      providerId: isUnresolvable ? undefined : (effectiveProviderId ?? undefined),
    };

    if (isDraft && draftWorkDir) {
      // Create the session + run its first turn atomically; the server snapshot
      // drives the redirect to `/session/:id`.
      sendWS('start_session', { workDir: draftWorkDir, ...flags });
      return;
    }

    if (!sessionId) return;
    useChatStore.getState().addPendingUserBlock(sessionId, content);
    sendWS('send_message', flags, sessionId);
  };

  // Session id or draft workDir, so the bypass confirm fires once per composer.
  const bypassAckKey = sessionId ?? draftWorkDir ?? '';

  const applyApprovalMode = (mode: ApprovalMode) => {
    if (isDraft) {
      setDraftApprovalMode(mode);
      withSilentSave(() => useSessionDefaultsStore.getState().setApprovalMode(mode));
      return;
    }
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { approvalMode: mode });
    withSilentSave(() => useSessionDefaultsStore.getState().setApprovalMode(mode));
  };

  // Switching to bypass is gated by a confirm dialog the first time per composer.
  // ask / safe apply immediately.
  const setApprovalMode = (mode: ApprovalMode) => {
    if (!canCompose) return;
    if (mode === 'bypass' && approvalMode !== 'bypass' && !bypassAcknowledged.has(bypassAckKey)) {
      setBypassConfirmOpen(true);
      return;
    }
    applyApprovalMode(mode);
  };

  const confirmBypass = () => {
    if (bypassAckKey) bypassAcknowledged.add(bypassAckKey);
    setBypassConfirmOpen(false);
    applyApprovalMode('bypass');
  };

  const toggleThinking = () => {
    if (isDraft) {
      setDraftThinking((on) => {
        const next = !on;
        withSilentSave(() => useSessionDefaultsStore.getState().setThinking(next));
        return next;
      });
      return;
    }
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { thinking: !thinking });
    withSilentSave(() => useSessionDefaultsStore.getState().setThinking(!thinking));
  };

  // One-shot ripple feedback when Ultracode flips on; keyed so re-toggling restarts it.
  const [ultracodeRipple, setUltracodeRipple] = useState(0);

  const toggleUltracode = () => {
    if (!ultracode) setUltracodeRipple((k) => k + 1);
    if (isDraft) {
      setDraftUltracode((on) => {
        const next = !on;
        withSilentSave(() => useSessionDefaultsStore.getState().setUltracode(next));
        return next;
      });
      return;
    }
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { ultracode: !ultracode });
    withSilentSave(() => useSessionDefaultsStore.getState().setUltracode(!ultracode));
  };

  const setEffort = (next: EffortLevel | null) => {
    if (isDraft) {
      setDraftEffort(next);
      withSilentSave(() => useSessionDefaultsStore.getState().setEffort(next));
      return;
    }
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { effort: next });
    withSilentSave(() => useSessionDefaultsStore.getState().setEffort(next));
  };

  // Set the local override and silently persist it to Session Defaults, in one
  // synchronous handler so the silent-save context stays intact.
  const selectModel = (providerId: string, modelId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModel(modelId);
    withSilentSave(() => {
      useSessionDefaultsStore.getState().setProviderId(providerId);
      useSessionDefaultsStore.getState().setModel(modelId);
    });
  };

  // Rewrite the composer to `/name ` (the trailing space closes the picker and
  // positions for arguments) and move the caret to the end.
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

  // Toolbar affordance for the slash picker: seed a bare slash into an empty
  // composer (which matches SLASH_PICKER_RE and opens the menu) and focus. A
  // non-empty draft is left intact — only focus — so the button never clobbers it.
  const openCommandPicker = () => {
    if (!canCompose) return;
    setPickerDismissed(false);
    if (text.trim() === '') setText('/');
    const el = textareaRef.current;
    if (el) {
      el.focus();
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
      // Ctrl/Cmd+Enter always sends. Plain Enter sends only on fine pointers
      // (see ENTER_INSERTS_NEWLINE); any other modifier inserts a newline.
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

  const placeholderText = !canCompose
    ? 'Select or create a project to start...'
    : noModelsAvailable
      ? 'No models available — configure a provider to start'
      : needsSelection
        ? 'Select a model to start...'
        : isTurnInProgress
          ? 'Agent is running — press Stop to halt'
          : 'Ask anything...';

  const builtinProviders = available?.builtin ?? [];
  const personalProviders = available?.personal ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-4 md:px-4 md:pb-6 shrink-0 bg-transparent">
      <div
        className={`relative rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-1 ${
          ultracode
            ? 'border-ultracode/50 focus-within:ring-ultracode/40'
            : isTurnInProgress
              ? 'border-primary/30 focus-within:ring-ring'
              : 'border-border focus-within:ring-ring'
        }`}
      >
        {/* Static plum glow while Ultracode is on — separate overlay so it
            never fights Tailwind's ring/shadow composition on the container. */}
        {ultracode && (
          <span
            aria-hidden="true"
            className="ultracode-glow pointer-events-none absolute -inset-px rounded-2xl"
          />
        )}
        {pickerOpen && (
          <SlashCommandMenu
            items={pickerItems}
            activeIndex={activeIndex}
            filter={pickerFilter}
            onSelect={selectCommand}
            onHover={setActiveIndex}
          />
        )}
        {/* Welcome only: pick/clone a project, which routes to the draft composer. */}
        {isWelcome && (
          <div className="px-3 pt-3">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={selectProject}
              disabled={authStatus !== 'authenticated'}
              className="cursor-pointer rounded-xl"
              title={
                authStatus === 'authenticated'
                  ? 'Pick a project or clone a repo to start'
                  : 'Log in to start a task'
              }
            >
              <FolderGit2 className="h-3.5 w-3.5" />
              Select Project
            </Button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={!canCompose || noModelsAvailable}
          aria-label="Chat input"
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
          style={{ minHeight: '44px', maxHeight: '144px' }}
        />
        {/* Controls bar: Approval + Model on the left, Send/Stop on the right. */}
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={openCommandPicker}
              disabled={!canCompose}
              className="cursor-pointer rounded-xl border border-border bg-card-2 px-2 text-muted-foreground transition-colors hover:bg-muted"
              aria-label="Commands"
              title="Slash commands"
            >
              <SquareSlash className="h-3.5 w-3.5" />
            </Button>
            <span className="inline-flex min-w-0 items-center rounded-xl border border-border bg-card-2 px-1 transition-colors hover:bg-muted">
              <DropdownMenu
                align="start"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={`cursor-pointer ${approvalMode === 'bypass' ? 'text-warning' : 'text-muted-foreground'}`}
                    disabled={!canCompose}
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
                      <Zap className="h-3 w-3 text-warning" />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Run every tool without asking
                    </span>
                  </span>
                </DropdownItem>
              </DropdownMenu>
            </span>

            <span className="inline-flex min-w-0 items-center rounded-xl border border-border bg-card-2 px-1 transition-colors hover:bg-muted">
              <DropdownMenu
                align="end"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={`cursor-pointer ${needsSelection ? 'text-warning' : 'text-muted-foreground'}`}
                    disabled={!canCompose}
                    aria-label="Model"
                    title={
                      isUnresolvable
                        ? MSG_MODEL_UNRESOLVABLE
                        : needsSelection
                          ? MSG_SELECT_MODEL
                          : 'Model — applies from the next message'
                    }
                  >
                    {/* Compact (no namespace) on mobile, full form on desktop. */}
                    <span className="max-w-[16ch] truncate sm:hidden">{modelLabelCompact}</span>
                    <span className="hidden max-w-[16ch] truncate sm:inline">{modelLabel}</span>
                    {/* Effort pill via effortPill helper, only under extended thinking.
                        Ultracode overrides the display to Xhigh ("X"). */}
                    {ultracode ? (
                      <span className="font-semibold uppercase text-ultracode">{' · X'}</span>
                    ) : thinking && effort ? (
                      <span className="font-semibold uppercase text-primary">
                        {' · '}
                        {effortPill(effort)}
                      </span>
                    ) : null}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                }
              >
                <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none truncate max-w-[20ch]">
                  {modelLabel}
                </div>

                <ModelProviderSection
                  label="Built-in"
                  providers={builtinProviders}
                  effectiveProviderId={effectiveProviderId}
                  effectiveModel={effectiveModel}
                  onSelect={selectModel}
                />

                <ModelProviderSection
                  label="Personal"
                  providers={personalProviders}
                  effectiveProviderId={effectiveProviderId}
                  effectiveModel={effectiveModel}
                  onSelect={selectModel}
                />

                {status === 'loading' && (
                  <div className="px-2 py-2 text-xs text-muted-foreground select-none">
                    Loading providers…
                  </div>
                )}

                {status === 'error' && (
                  <DropdownItem onClick={() => void load()}>
                    <span className="flex flex-col">
                      <span className="text-warning">Failed to load — retry</span>
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

                <DropdownSeparator />

                {/* Effort submenu with a Thinking toggle in its footer. Effort
                    only bites under extended thinking, so it's disabled when off.
                    Ultracode forces Xhigh and locks the whole submenu. */}
                <DropdownSubmenu
                  icon={<Gauge className="h-3.5 w-3.5" />}
                  label="Effort"
                  disabled={ultracode}
                  value={ultracode ? 'Xhigh' : thinking ? effortLabel(effort) : 'Off'}
                >
                  {EFFORT_OPTIONS.map((opt) => (
                    <DropdownItem
                      key={opt.label}
                      disabled={ultracode || !thinking}
                      onClick={() => setEffort(opt.value)}
                      icon={
                        <Check className={thinking && effort === opt.value ? '' : 'opacity-0'} />
                      }
                    >
                      <span>{opt.label}</span>
                    </DropdownItem>
                  ))}
                  <DropdownSeparator />
                  <DropdownItem
                    onClick={toggleThinking}
                    disabled={ultracode}
                    closeOnClick={false}
                    trailing={
                      <Switch
                        on={ultracode ? true : thinking}
                        tone={ultracode ? 'ultracode' : 'primary'}
                      />
                    }
                  >
                    <span className="flex items-center gap-2">
                      <Brain className="h-3.5 w-3.5" />
                      Thinking
                    </span>
                  </DropdownItem>
                </DropdownSubmenu>

                {/* Ultracode lives below Effort (not inside the submenu) so it
                    stays reachable while it locks the submenu above. */}
                <DropdownItem
                  onClick={toggleUltracode}
                  closeOnClick={false}
                  trailing={<Switch on={ultracode} tone="ultracode" />}
                >
                  <span className="flex items-center gap-2">
                    <span className="relative inline-flex">
                      <Rocket
                        className={`h-3.5 w-3.5 ${ultracode ? 'text-ultracode' : ''} transition-colors`}
                      />
                      {ultracodeRipple > 0 && (
                        <span
                          key={ultracodeRipple}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0"
                        >
                          <span className="ultracode-ripple absolute inset-0 rounded-full border border-ultracode" />
                          <span
                            className="ultracode-ripple absolute inset-0 rounded-full border border-ultracode"
                            style={{ animationDelay: '150ms' }}
                          />
                        </span>
                      )}
                    </span>
                    Ultracode
                  </span>
                </DropdownItem>
              </DropdownMenu>
            </span>
          </div>

          {isTurnInProgress ? (
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={!canCompose}
              aria-label="Stop turn"
              title="Stop the running agent"
              className="cursor-pointer rounded-lg p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={!text.trim() || !canCompose || noModelsAvailable || needsSelection}
              aria-label="Send message"
              className={`p-1.5 transition-colors ${
                text.trim() && canCompose && !noModelsAvailable && !needsSelection
                  ? 'cursor-pointer text-primary'
                  : 'text-muted-foreground/40'
              }`}
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          )}
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
