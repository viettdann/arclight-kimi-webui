import { ChevronDown, Paperclip, Send, Zap } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

export function ChatInput() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 6 * 24; // 6 rows approx
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const sendMessage = () => {
    if (!text.trim()) return;
    setText('');
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSend = sendMessage;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div className="relative rounded-2xl border border-border bg-card shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          aria-label="Chat input"
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm outline-none placeholder:text-muted-foreground"
          style={{ minHeight: '44px', maxHeight: '144px' }}
        />

        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              Create project
              <ChevronDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Quick action"
            >
              <Zap className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">SOLO Auto Model</span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim()}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
