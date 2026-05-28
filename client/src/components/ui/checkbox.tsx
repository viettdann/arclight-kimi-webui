import type * as React from 'react';

import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'h-4 w-4 shrink-0 cursor-pointer rounded border border-input bg-background text-primary transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
