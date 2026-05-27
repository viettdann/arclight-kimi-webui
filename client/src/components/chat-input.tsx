import { Brain, ChevronDown, Paperclip, Send, ShieldCheck, Square, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { SlashCommand } from 'shared/types';
import { Button } from '@/components/ui/button';
import { DropdownItem, DropdownMenu } from '@/components/ui/dropdown-menu';
import { useChatStore } from '../lib/chat-store';
import { sendWS } from '../lib/ws-send';

// Modes are resolved client-side: SDK still provides the description for these
// command names, but they are grouped under "Modes" instead of "Commands".
const MODE_COMMANDS = ['afk'];
// Excluded from every group — handled by dedicated UI, not the composer.
const EXCLUDED_COMMANDS = new Set(['plan', 'yolo']);

// `startIdx` là offset của item đầu nhóm trong danh sách phẳng `flatItems`,
// dùng để map highlight phẳng mà không phải mutate biến đếm trong lúc render.
type CommandGroup = { label: string; items: SlashCommand[]; startIdx: number };

/** Tách query từ text bắt đầu bằng '/': phần sau '/' tới khoảng trắng đầu tiên. */
function parseSlashQuery(text: string): string | null {
  if (text[0] !== '/') return null;
  const rest = text.slice(1);
  // User đã gõ thêm khoảng trắng → đã chọn xong lệnh, đóng picker.
  if (/\s/.test(rest)) return null;
  return rest;
}

function matchesQuery(cmd: SlashCommand, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystacks = [cmd.name, ...(cmd.aliases ?? [])].map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(q));
}

/** startsWith ưu tiên hơn includes (rank thấp hơn = đứng trước). */
function matchRank(cmd: SlashCommand, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const haystacks = [cmd.name, ...(cmd.aliases ?? [])].map((s) => s.toLowerCase());
  if (haystacks.some((h) => h.startsWith(q))) return 0;
  return 1;
}

export function ChatInput() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const session = useChatStore((s) => (sessionId ? s.sessions[sessionId] : null));
  const isTurnInProgress = session?.isTurnInProgress ?? false;
  const slashCommands =
    useChatStore((s) => (sessionId ? s.sessions[sessionId]?.slashCommands : null)) ?? [];

  // Approval mode + thinking phản ánh trạng thái thật từ snapshot (sống sót qua
  // reload). Đổi → optimistic update store + gửi WS; áp dụng từ tin nhắn kế tiếp
  // (server respawn CLI).
  const yoloMode = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.yoloMode ?? false) : false,
  );
  const thinking = useChatStore((s) =>
    sessionId ? (s.sessions[sessionId]?.thinking ?? false) : false,
  );

  const [highlightIdx, setHighlightIdx] = useState(0);

  const query = parseSlashQuery(text);
  const isPickerOpen = query !== null && !isTurnInProgress;

  // Nhóm lệnh đã lọc: Commands, Skills, Modes (giữ thứ tự này).
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

  // Giữ highlight trong khoảng hợp lệ khi danh sách lọc co lại theo từng keystroke.
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
  };

  const selectCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.name} `);
    setHighlightIdx(0);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = 'auto';
    }
  };

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
    sendWS('send_message', { content, thinking, yoloMode }, sessionId);
  };

  // Toggles only mutate local store state; the value is committed when the user
  // sends (it can't take effect before the next prompt anyway).
  const setApprovalMode = (yolo: boolean) => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { yoloMode: yolo });
  };

  const toggleThinking = () => {
    if (!sessionId) return;
    useChatStore.getState().setSessionFlags(sessionId, { thinking: !thinking });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isPickerOpen && flatItems.length > 0) {
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
      if (e.key === 'Escape') {
        e.preventDefault();
        // Đóng picker mà KHÔNG xoá nội dung đang gõ: chèn 1 space sau token
        // slash để parseSlashQuery trả null (query kết thúc ở khoảng trắng).
        setText((t) => (t.includes(' ') ? t : `${t} `));
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
      ? 'Agent đang chạy — bấm Stop để dừng'
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
              {flatItems.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {slashCommands.length === 0
                    ? 'Không tải được lệnh, thử lại sau'
                    : 'Không có lệnh phù hợp'}
                </div>
              ) : (
                groups.map((group) => (
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
                ))
              )}
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
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground cursor-pointer"
              disabled={!sessionId}
            >
              <span className="hidden sm:inline">Create project</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground cursor-pointer"
              aria-label="Quick action"
              disabled={!sessionId}
            >
              <Zap />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground cursor-pointer"
              aria-label="Attach file"
              disabled={!sessionId}
            >
              <Paperclip />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={toggleThinking}
              disabled={!sessionId}
              aria-label="Chế độ suy nghĩ"
              aria-pressed={thinking}
              title="Suy nghĩ (thinking) — áp dụng từ tin nhắn kế tiếp"
              className={`cursor-pointer ${thinking ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <Brain className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Thinking</span>
            </Button>

            <DropdownMenu
              align="end"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground cursor-pointer"
                  disabled={!sessionId}
                  aria-label="Chế độ phê duyệt"
                  title="Áp dụng từ tin nhắn kế tiếp"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{yoloMode ? 'YOLO' : 'Normal'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground select-none">
                Áp dụng từ tin nhắn kế tiếp
              </div>
              <DropdownItem onClick={() => setApprovalMode(false)}>Normal</DropdownItem>
              <DropdownItem onClick={() => setApprovalMode(true)}>YOLO</DropdownItem>
            </DropdownMenu>

            {isTurnInProgress ? (
              <Button
                type="button"
                size="icon-sm"
                variant="destructive"
                onClick={handlePrimaryAction}
                disabled={!sessionId}
                aria-label="Stop turn"
                title="Dừng phiên agent đang chạy"
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
    </div>
  );
}
