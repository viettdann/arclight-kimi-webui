import { Check, Pencil, X } from 'lucide-react';
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

/**
 * Secret entry with two shapes:
 *   - No saved secret yet (`!isSet`): a plain editable input — type directly.
 *   - Saved secret (`isSet`): locked behind a pencil. Unlock to type a
 *     replacement, then ✓ stages it (held in form state, not persisted) or ✗
 *     discards it. The surrounding form's Save button persists a staged value.
 */
export function SecretField({
  id,
  label,
  masked,
  isSet,
  value,
  onChange,
  placeholder,
}: SecretFieldProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState('');
  // Snapshot the masked display string at mount so it doesn't flicker on edit.
  const maskedRef = useRef(masked);

  // A staged replacement: the user committed a new value that isn't saved yet.
  const staged = isSet && !unlocked && typeof value === 'string';

  function beginEdit() {
    setDraft(typeof value === 'string' ? value : '');
    setUnlocked(true);
  }

  function commitEdit() {
    onChange(draft);
    setUnlocked(false);
  }

  function discardEdit() {
    onChange(null);
    setDraft('');
    setUnlocked(false);
  }

  // No saved secret: plain editable input, no gating.
  if (!isSet) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="text"
          value={value ?? ''}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        {unlocked ? (
          <>
            <Input
              id={id}
              type="text"
              value={draft}
              placeholder={placeholder}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={commitEdit}
              disabled={draft.trim().length === 0}
              aria-label="Confirm new key"
              title="Stage this key (saved on Save)"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={discardEdit}
              aria-label="Cancel"
              title="Discard"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Input
              id={id}
              type="text"
              value={staged ? '•••••••• (new)' : maskedRef.current}
              readOnly
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={beginEdit}
              aria-label="Modify key"
              title="Modify"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {staged && (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={discardEdit}
                aria-label="Discard staged key"
                title="Discard staged key"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
      {staged && <p className="text-xs text-muted-foreground">New key staged — Save to apply.</p>}
    </div>
  );
}
