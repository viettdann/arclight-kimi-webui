import { Checkbox } from '@/components/ui/checkbox';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors">
      <Checkbox
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground mt-0.5">{description}</span>
        )}
      </div>
    </label>
  );
}
