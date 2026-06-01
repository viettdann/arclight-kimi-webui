import type * as React from 'react';

import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

/**
 * Accessible on/off toggle. Matches the design's pill switch (track + sliding
 * knob) rather than a checkbox. Driven by `checked`/`onCheckedChange`.
 */
function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...aria
}: SwitchProps & React.AriaAttributes) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-slot="switch"
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-border-strong',
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export { Switch };
