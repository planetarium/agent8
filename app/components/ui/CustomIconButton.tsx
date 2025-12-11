import React from 'react';
import { classNames } from '~/utils/classNames';

interface CustomIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'primary'
    | 'primary-transparent'
    | 'secondary'
    | 'secondary-ghost'
    | 'secondary-transparent'
    | 'secondary-outlined';
  size?: 'sm' | 'md';
  icon: React.ReactNode;
  disabled?: boolean;
}

const CustomIconButton = React.forwardRef<HTMLButtonElement, CustomIconButtonProps>(
  ({ className, variant = 'primary', size = 'md', icon, disabled, ...props }, ref) => {
    const baseStyles =
      "relative inline-flex justify-center items-center gap-[6px] rounded-[4px] border font-medium transition-colors duration-200 focus:outline-none focus-visible:before:content-[''] focus-visible:before:absolute focus-visible:before:right-[-2.727px] focus-visible:before:top-[-3px] focus-visible:before:left-[-3px] focus-visible:before:bottom-[-3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:pointer-events-none";

    const sizeStyles = {
      sm: 'p-[8px]',
      md: 'p-[8px]',
    };

    const variantStyles = {
      primary:
        'border-interactive-neutral bg-interactive text-interactive-on-primary hover:border-interactive-neutral-hover hover:bg-interactive-hover hover:text-interactive-on-primary-hover active:border-interactive-neutral-pressed active:bg-interactive-pressed active:text-interactive-on-primary-pressed',
      'primary-transparent':
        'border-transparent text-interactive hover:text-interactive-hover active:text-interactive-pressed',
      secondary:
        'border-interactive-neutral bg-interactive-neutral text-interactive-neutral-hover hover:text-interactive-neutral-hover hover:bg-interactive-neutral-hover hover:border-interactive-neutral-hover active:text-interactive-neutral-pressed active:bg-interactive-neutral-pressed active:border-interactive-neutral-pressed',
      'secondary-ghost':
        'border-interactive-neutral bg-interactive-neutral text-interactive-on-primary hover:border-interactive-neutral-hover hover:bg-interactive-neutral-hover active:border-interactive-neutral-pressed active:bg-interactive-neutral-pressed',
      'secondary-transparent':
        'bg-transparent border-transparent text-interactive-neutral hover:text-interactive-neutral-hover active:text-interactive-neutral-pressed',
      'secondary-outlined':
        'rounded-radius-4 border-interactive-neutral text-interactive-neutral bg-transparent hover:border-interactive-neutral-hovered hover:text-interactive-neutral-hovered active:border-interactive-neutral-pressed active:bg-interactive-neutral-pressed active:text-interactive-neutral-pressed',
    };

    return (
      <button
        ref={ref}
        className={classNames(baseStyles, sizeStyles[size], variantStyles[variant], className)}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        {...props}
      >
        {icon}
      </button>
    );
  },
);

CustomIconButton.displayName = 'CustomIconButton';

export default CustomIconButton;
export type { CustomIconButtonProps };
