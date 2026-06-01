import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface KeyValueEditorProps {
  label?: string;
  description?: string;
  data: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({
  label,
  description,
  data,
  onChange,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
}: KeyValueEditorProps) {
  const entries = Object.entries(data);

  function update(idx: number, key: string, value: string) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      next[i === idx ? key : k] = i === idx ? value : v;
    });
    onChange(next);
  }

  function remove(idx: number) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      if (i !== idx) next[k] = v;
    });
    onChange(next);
  }

  function add() {
    onChange({ ...data, '': '' });
  }

  return (
    <div className="space-y-2">
      {(label || description) && (
        <div className="flex items-end justify-between gap-2">
          <div>
            {label && (
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {label}
              </p>
            )}
            {description && (
              <p className="text-xs text-muted-foreground/80 mt-0.5">{description}</p>
            )}
          </div>
          <Button type="button" variant="outline" size="xs" onClick={add}>
            + Add
          </Button>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-3 text-center">
          No entries
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(([k, v], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: entries shift on edit
            <div key={i} className="flex gap-2">
              <Input
                value={k}
                placeholder={keyPlaceholder}
                onChange={(e) => update(i, e.target.value, v)}
                className="flex-1"
              />
              <Input
                value={v}
                placeholder={valuePlaceholder}
                onChange={(e) => update(i, k, e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                className="text-destructive hover:text-destructive"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      {!label && !description && (
        <Button type="button" variant="outline" size="xs" onClick={add}>
          + Add
        </Button>
      )}
    </div>
  );
}
