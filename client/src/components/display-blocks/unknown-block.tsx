interface UnknownBlockProps {
  rawType: string;
  raw: Record<string, unknown>;
}

export function UnknownBlock({ rawType, raw }: UnknownBlockProps) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs font-mono">
      <div className="mb-2 flex items-center justify-between text-muted-foreground border-b border-border/50 pb-1.5 font-sans">
        <span className="font-semibold">Unknown Block: {rawType}</span>
      </div>
      <pre className="overflow-x-auto text-muted-foreground max-h-48 scrollbar-thin">
        {JSON.stringify(raw, null, 2)}
      </pre>
    </div>
  );
}
