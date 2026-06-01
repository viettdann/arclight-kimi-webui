import type * as React from 'react';

import { cn } from '@/lib/utils';

interface SectionProps extends React.ComponentProps<'section'> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

function Section({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      data-slot="section"
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

export { Section };
