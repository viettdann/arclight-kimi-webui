import { Menu } from '@base-ui/react/menu';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  sideOffset = 6,
}: DropdownMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner align={align} side="bottom" sideOffset={sideOffset} className="z-50">
          <Menu.Popup
            className={cn(
              'min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
              'origin-[var(--transform-origin)] outline-none',
              'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
              'transition-opacity duration-100',
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
  children: ReactNode;
}

export function DropdownItem({
  onClick,
  disabled,
  destructive,
  icon,
  children,
}: DropdownItemProps) {
  return (
    <Menu.Item
      disabled={disabled}
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
    </Menu.Item>
  );
}
