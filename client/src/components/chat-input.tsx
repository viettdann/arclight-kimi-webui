import { Brain, Check, ChevronDown, Send, ShieldCheck, Square, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { ApprovalMode } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { useChatStore } from '../lib/chat-store';
import { useDraftStore } from '../lib/draft-store';
import { labelFor, useProvidersStore } from '../lib/providers-store';
import { useSessionsStore } from '../lib/sessions-store';
import { sendWS } from '../lib/ws-send';
import { ConfirmBypassDialog } from './confirm-bypass-dialog';

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
  const { available, ensureLoaded } = useProvidersStore();
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

  // Human-readable label for the current selection.
  const modelLabel = labelFor(available, effectiveProviderId, effectiveModel) ?? 'Select a model';

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
    const content = text.trim();
    setText('');
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';

    useChatStore.getState().addPendingUserBlock(sessionId, content);
    // Composer flags ride along with the send — no separate message. The server
    // applies them just before spawning the turn and persists only real flips.
    // Both model and providerId are included when the user made an override pick;
    // omitting them leaves the session's current selection unchanged.
    sendWS(
      'send_message',
      {
        content,
        thinking,
        approvalMode,
        model: selectedModel ?? sessionModel ?? undefined,
        providerId: selectedProviderId ?? sessionProviderId ?? undefined,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    : isTurnInProgress
      ? 'Agent is running — press Stop to halt'
      : 'Ask anything...';

  // Build flat model lists for dropdown.
  const builtinProviders = available?.builtin ?? [];
  const personalProviders = available?.personal ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-4 md:px-4 md:pb-6 shrink-0">
      <div
        className={`relative rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-1 focus-within:ring-ring ${
          isTurnInProgress ? 'border-primary/30' : 'border-border'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium select-none ${
              thinking ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
            title="Thinking status — change it in the model menu"
          >
            <Brain className="h-3.5 w-3.5" />
            {thinking ? 'Thinking on' : 'Thinking off'}
          </span>

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
                  className="text-muted-foreground cursor-pointer"
                  disabled={!sessionId}
                  aria-label="Model"
                  title="Model — applies from the next message"
                >
                  {thinking && <Brain className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline max-w-[16ch] truncate">{modelLabel}</span>
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

              {builtinProviders.length === 0 && personalProviders.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground select-none">
                  No providers configured
                </div>
              )}

              <DropdownItem onClick={toggleThinking}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Brain className="h-3.5 w-3.5" />
                    Thinking
                  </span>
                  <Switch on={thinking} />
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

      <ConfirmBypassDialog
        isOpen={bypassConfirmOpen}
        onConfirm={confirmBypass}
        onClose={() => setBypassConfirmOpen(false)}
      />
    </div>
  );
}
