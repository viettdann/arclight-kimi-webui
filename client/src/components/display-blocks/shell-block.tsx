import { Check, Copy, Terminal } from 'lucide-react';
import { useState } from 'react';

interface ShellBlockProps {
  command: string;
  language: string;
}

export function ShellBlock({ command, language }: ShellBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-lg overflow-hidden backdrop-blur-sm animate-in fade-in duration-200">
      {/* Terminal Window Header */}
      <div className="flex items-center justify-between bg-zinc-900 px-4 py-2 border-b border-zinc-800 text-xs select-none">
        <div className="flex items-center gap-2">
          {/* Window control dots */}
          <div className="flex gap-1.5 mr-1">
            <span className="h-3 w-3 rounded-full bg-red-500/80" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400 font-mono">
            <Terminal className="h-3.5 w-3.5 text-zinc-500" />
            <span>terminal</span>
            {language && (
              <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-500">
                {language}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Terminal Body */}
      <div className="p-4 font-mono text-xs text-zinc-300 overflow-x-auto leading-relaxed select-text">
        <div className="flex gap-2">
          <span className="text-emerald-500 select-none">$</span>
          <pre className="whitespace-pre-wrap flex-1">{command}</pre>
        </div>
      </div>
    </div>
  );
}
