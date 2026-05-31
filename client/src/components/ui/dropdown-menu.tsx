import { Menu } from '@base-ui/react/menu';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  /** Extra classes merged into the popup (e.g. `w-[var(--anchor-width)]` to match the trigger). */
  contentClassName?: string;
}

export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  sideOffset = 6,
  contentClassName,
}: DropdownMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50">
          <Menu.Popup
            className={cn(
              'min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
              'origin-[var(--transform-origin)] outline-none',
              'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
              'transition-opacity duration-100',
              contentClassName,
            )}
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

interface DropdownItemProps {
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
  /** Right-aligned content (a value label and/or a chevron). */
  trailing?: ReactNode;
  /** Keep the menu open after a click (e.g. an in-menu toggle). Defaults to true. */
  closeOnClick?: boolean;
  children: ReactNode;
}

export function DropdownItem({
  onClick,
  disabled,
  destructive,
  icon,
  trailing,
  closeOnClick = true,
  children,
}: DropdownItemProps) {
  return (
    <Menu.Item
      disabled={disabled}
      closeOnClick={closeOnClick}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive &&
          'text-destructive data-[highlighted]:bg-destructive/15 data-[highlighted]:text-destructive',
      )}
    >
      {icon ? <span className="[&_svg]:size-4">{icon}</span> : null}
      <span className="flex-1 truncate">{children}</span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </Menu.Item>
  );
}

/** Full-bleed divider between groups inside a dropdown popup. */
export function DropdownSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" aria-hidden />;
}
