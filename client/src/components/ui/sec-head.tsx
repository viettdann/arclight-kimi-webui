import type * as React from 'react';

import { cn } from '@/lib/utils';

interface SecHeadProps {
  title: string;
  description?: React.ReactNode;
  /** Primary action(s) shown on the right, aligned with the title. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Page-level heading for a Settings/Preferences panel: a large title, a muted
 * one-line description, and an optional right-aligned action. Sits above the
 * panel's cards — distinct from <Section>, which frames a single bordered card.
 */
function SecHead({ title, description, actions, className }: SecHeadProps) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[28px] font-medium leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </div>
  );
}

export { SecHead };
