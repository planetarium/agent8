import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

interface DropdownItemProps {
  children: ReactNode;
  onSelect?: () => void;
  className?: string;
  disabled?: boolean;
}

export const DropdownItem = ({ children, onSelect, className, disabled }: DropdownItemProps) => (
  <DropdownMenu.Item
    className={classNames(
      'relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
      'text-bolt-elements-textPrimary',
      (!disabled && 'hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary cursor-pointer') ||
        '',
      (disabled && 'text-bolt-elements-textSecondary') || '',
      'transition-colors ',
      'outline-none',
      className,
    )}
    onSelect={!disabled ? onSelect : undefined}
    disabled={disabled}
  >
    {children}
  </DropdownMenu.Item>
);

export const DropdownSeparator = () => <DropdownMenu.Separator className="h-px bg-bolt-elements-borderColor my-1" />;

export const Dropdown = ({ trigger, children, align = 'end', sideOffset = 5 }: DropdownProps) => {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={classNames(
            'min-w-[220px] rounded-lg p-2',
            'bg-bolt-elements-background-depth-2',
            'border border-bolt-elements-borderColor',
            'shadow-lg',
            'animate-in fade-in-80 zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2',
            'data-[side=top]:slide-in-from-bottom-2',
            'z-[1000]',
          )}
          sideOffset={sideOffset}
          align={align}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
