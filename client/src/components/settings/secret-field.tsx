import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SecretFieldProps {
  id: string;
  label: string;
  /** Server-masked current value (e.g. ***abcd), shown until the user edits. */
  masked: string;
  /** Whether a secret is already set on the server. */
  isSet: boolean;
  /** Current draft plaintext value, or null when not editing (keep saved). */
  value: string | null;
  /** Called with the new plaintext, or null to revert to the saved secret. */
  onChange: (value: string | null) => void;
  placeholder?: string;
}

export function SecretField({
  id,
  label,
  masked,
  isSet,
  value,
  onChange,
  placeholder,
}: SecretFieldProps) {
  // True once the user has staged a new value (value holds a string, not null).
  const editing = typeof value === 'string';
  const [reveal, setReveal] = useState(false);
  // Snapshot the masked display string at mount so it doesn't flicker on edit.
  const maskedRef = useRef(masked);

  function enterReplace() {
    onChange('');
    setReveal(true);
  }

  function cancelReplace() {
    onChange(null);
    setReveal(false);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        {editing ? (
          <Input
            id={id}
            type={reveal ? 'text' : 'password'}
            value={value}
            placeholder={placeholder}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input
            id={id}
            type="text"
            value={isSet ? maskedRef.current : ''}
            readOnly
            placeholder={isSet ? undefined : '(not configured)'}
            className="font-mono"
          />
        )}
        {editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? 'Hide' : 'Show'}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (editing ? cancelReplace() : enterReplace())}
        >
          {editing ? 'Cancel' : isSet ? 'Replace' : 'Set'}
        </Button>
      </div>
    </div>
  );
}
