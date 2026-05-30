import { Brain, Check, ChevronDown, Send, ShieldCheck, Square, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { ApprovalMode } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { useChatStore } from '../lib/chat-store';
import { MODELS, resolveModel, useConfigStore } from '../lib/config-store';
import { useDraftStore } from '../lib/draft-store';
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

  // Config carries the default model used when the session has none. Cached fetch.
  const ensureConfigLoaded = useConfigStore((s) => s.ensureLoaded);
  // Subscribe to the loaded DEFAULT_MODEL so the label re-resolves after fetch.
  useConfigStore((s) => s.settings.DEFAULT_MODEL?.value);
  useEffect(() => ensureConfigLoaded(), [ensureConfigLoaded]);

  const sessionModel = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.model ?? null,
  );
  // Model picks are local UI state until the user sends (mirrors thinking/approval):
  // the chosen model rides along with the next `send_message` and the server applies
  // it via `Query.setModel`. `null` → fall back to the session/default model.
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // Resolve the chosen model first; otherwise the session's model, otherwise default.
  const { id: modelId, label: modelLabel } = resolveModel(selectedModel ?? sessionModel);

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
    // A pending model override is included only when the user picked one; omitted
    // leaves the session's current model unchanged.
    sendWS(
      'send_message',
      { content, thinking, approvalMode, model: selectedModel ?? undefined },
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
                  <span className="hidden sm:inline">{modelLabel ?? 'Model'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none">
                {modelLabel ?? 'Model'}
              </div>
              {MODELS.map((m) => (
                <DropdownItem
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  icon={<Check className={m.id === modelId ? '' : 'opacity-0'} />}
                >
                  <span>{m.label}</span>
                </DropdownItem>
              ))}
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
