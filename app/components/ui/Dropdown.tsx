import { type ReactNode, useState, useRef, useEffect } from 'react';
import { classNames } from '~/utils/classNames';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export const DropdownItem = ({ children, onClick, className, disabled }: DropdownItemProps) => (
  <div
    className={classNames(
      'flex items-center gap-4 py-[14px] px-5 self-stretch',
      'bg-interactive-neutral text-primary',
      'transition-colors outline-none',
      {
        'hover:bg-interactive-neutral-hovered cursor-pointer': !disabled,
        'text-tertiary': !!disabled,
      },
      className,
    )}
    onClick={!disabled ? onClick : undefined}
  >
    {children}
  </div>
);

export const DropdownSeparator = () => <div className="h-px bg-bolt-elements-borderColor my-1" />;

export const Dropdown = ({ trigger, children, align = 'end', open, onOpenChange }: DropdownProps) => {
  const [internalOpen, setInternalOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Controlled or uncontrolled
  const isOpen = open !== undefined ? open : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, setIsOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>

      {isOpen && (
        <div
          className={classNames(
            'absolute top-full mt-1 flex w-[260px] py-2 flex-col items-start rounded-lg border border-tertiary bg-interactive-neutral z-[1000]',
            {
              'right-0': align === 'end',
              'left-0': align === 'start',
              'left-1/2 -translate-x-1/2': align === 'center',
            },
          )}
          style={{
            boxShadow: '0 8px 16px 0 rgba(0, 0, 0, 0.32), 0 0 8px 0 rgba(0, 0, 0, 0.28)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
