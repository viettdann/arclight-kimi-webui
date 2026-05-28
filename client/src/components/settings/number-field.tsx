import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}

export function NumberField({ label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          const clamped = min !== undefined ? Math.max(min, n) : n;
          onChange(max !== undefined ? Math.min(max, clamped) : clamped);
        }}
      />
    </div>
  );
}
