import { Check, Copy, FileText } from 'lucide-react';
import { useState } from 'react';

interface DiffBlockProps {
  path: string;
  oldText: string;
  newText: string;
}

export function DiffBlock({ path, oldText, newText }: DiffBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(newText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Simple line-by-line diff generator for visualization
  const getDiffLines = () => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diff: {
      type: 'addition' | 'deletion' | 'normal';
      content: string;
      numOld?: number;
      numNew?: number;
    }[] = [];

    let o = 0;
    let n = 0;

    while (o < oldLines.length || n < newLines.length) {
      if (o < oldLines.length && n < newLines.length) {
        if (oldLines[o] === newLines[n]) {
          diff.push({ type: 'normal', content: oldLines[o]!, numOld: o + 1, numNew: n + 1 });
          o++;
          n++;
        } else {
          // Lookahead to find next match
          let foundMatch = false;
          for (let look = 1; look <= 5; look++) {
            if (o + look < oldLines.length && oldLines[o + look] === newLines[n]) {
              // old lines were deleted
              for (let i = 0; i < look; i++) {
                diff.push({ type: 'deletion', content: oldLines[o + i]!, numOld: o + i + 1 });
              }
              o += look;
              foundMatch = true;
              break;
            }
            if (n + look < newLines.length && oldLines[o] === newLines[n + look]) {
              // new lines were added
              for (let i = 0; i < look; i++) {
                diff.push({ type: 'addition', content: newLines[n + i]!, numNew: n + i + 1 });
              }
              n += look;
              foundMatch = true;
              break;
            }
          }

          if (!foundMatch) {
            // treat as replace (delete old line, add new line)
            diff.push({ type: 'deletion', content: oldLines[o]!, numOld: o + 1 });
            diff.push({ type: 'addition', content: newLines[n]!, numNew: n + 1 });
            o++;
            n++;
          }
        }
      } else if (o < oldLines.length) {
        diff.push({ type: 'deletion', content: oldLines[o]!, numOld: o + 1 });
        o++;
      } else if (n < newLines.length) {
        diff.push({ type: 'addition', content: newLines[n]!, numNew: n + 1 });
        n++;
      }
    }

    return diff;
  };

  const diffLines = getDiffLines();
  const filename = path.split('/').pop() || path;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden backdrop-blur-sm">
      <div className="flex items-center justify-between bg-muted/40 px-4 py-2 border-b border-border/80 text-xs font-medium">
        <div className="flex items-center gap-2 text-foreground/80 font-mono">
          <FileText className="h-4 w-4 text-primary" />
          <span>{filename}</span>
          <span className="text-[10px] text-muted-foreground font-sans">({path})</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span>{copied ? 'Copied' : 'Copy New'}</span>
        </button>
      </div>

      <div className="font-mono text-xs overflow-x-auto divide-y divide-border/10 max-h-96 scrollbar-thin">
        <table className="w-full border-collapse">
          <tbody>
            {diffLines.map((line, idx) => {
              const isAdd = line.type === 'addition';
              const isDel = line.type === 'deletion';
              const rowBg = isAdd
                ? 'bg-emerald-500/10 text-emerald-400'
                : isDel
                  ? 'bg-red-500/10 text-red-400'
                  : 'text-foreground/80 hover:bg-muted/10';
              const indicator = isAdd ? '+' : isDel ? '-' : ' ';

              return (
                <tr key={idx} className={`${rowBg} transition-colors group`}>
                  <td className="w-10 select-none text-right pr-2.5 pl-2 py-0.5 border-r border-border/10 text-[10px] text-muted-foreground/40 font-mono">
                    {line.numOld || ''}
                  </td>
                  <td className="w-10 select-none text-right pr-2.5 pl-2 py-0.5 border-r border-border/10 text-[10px] text-muted-foreground/40 font-mono">
                    {line.numNew || ''}
                  </td>
                  <td className="w-6 select-none text-center font-bold font-mono text-[11px] text-muted-foreground/30 pl-2">
                    {indicator}
                  </td>
                  <td className="px-3 py-0.5 whitespace-pre font-mono leading-relaxed">
                    {line.content}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
