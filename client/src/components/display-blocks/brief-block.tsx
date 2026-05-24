import { Info } from 'lucide-react';

interface BriefBlockProps {
  text: string;
}

export function BriefBlock({ text }: BriefBlockProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-foreground/90 shadow-sm backdrop-blur-sm animate-in fade-in slide-in-from-top-1 duration-200">
      <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
      <div className="flex-1 font-medium">{text}</div>
    </div>
  );
}
