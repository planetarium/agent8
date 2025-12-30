import React from 'react';
import { classNames } from '~/utils/classNames';

interface CustomButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?:
    | 'primary'
    | 'secondary'
    | 'primary-text'
    | 'primary-ghost'
    | 'primary-filled'
    | 'primary-gradient'
    | 'secondary-text'
    | 'secondary-outlined'
    | 'secondary-ghost'
    | 'destructive-filled';
  size?: 'sm' | 'md' | 'lg';
  asChild?: boolean;
}

const CustomButton = React.forwardRef<HTMLButtonElement, CustomButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, asChild = false, ...props }, ref) => {
    const baseStyles =
      "relative inline-flex justify-center items-center font-semibold leading-[142.9%] transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:before:absolute focus-visible:before:-top-[3px] focus-visible:before:-right-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none";

    const variants = {
      primary:
        'bg-interactive text-interactive-on-primary border border-interactive-neutral hover:bg-interactive-hovered hover:border-interactive-neutral-hovered hover:text-interactive-on-primary-hovered active:bg-interactive-pressed active:border-interactive-neutral-pressed active:text-interactive-on-primary-pressed focus-visible:bg-interactive focus-visible:border-interactive-neutral disabled:bg-disabled disabled:border-disabled disabled:text-disabled',
      secondary:
        'text-interactive-neutral hover:text-interactive-neutral-hovered active:text-interactive-neutral-pressed bg-transparent ',
      'primary-text':
        "bg-transparent text-interactive-primary border-none hover:text-interactive-hovered active:text-interactive-pressed focus-visible:text-interactive rounded-[4px] focus-visible:before:absolute focus-visible:before:-right-[3.133px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3.133px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
      'primary-ghost':
        'rounded-[4px] border border-interactive-neutral bg-interactive-neutral text-interactive hover:bg-interactive-neutral-hovered hover:border-interactive-neutral-hovered hover:text-interactive-hovered active:bg-interactive-neutral-pressed active:border-interactive-neutral-pressed active:text-interactive-pressed focus-visible:bg-interactive-neutral focus-visible:border-interactive-neutral',
      'secondary-ghost':
        "rounded-[4px] border border-interactive-neutral bg-interactive-neutral text-interactive-neutral hover:bg-interactive-neutral-hovered hover:border-interactive-neutral-hovered hover:text-interactive-neutral-hovered active:bg-interactive-neutral-pressed active:border-interactive-neutral-pressed active:text-interactive-neutral-pressed focus-visible:bg-interactive-neutral focus-visible:border-interactive-neutral focus-visible:before:absolute focus-visible:before:-right-[3px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
      'primary-filled':
        "rounded-[4px] border border-interactive-neutral bg-[var(--color-bg-interactive-primary,#1a92a4)] text-interactive-on-primary hover:bg-[var(--color-bg-interactive-primary-hovered,#1a7583)] hover:border-[var(--color-border-interactive-neutral-hovered,rgba(255,255,255,0.22))] active:bg-[var(--color-bg-interactive-primary-pressed,#1b5862)] active:border-[var(--color-border-interactive-neutral-pressed,rgba(255,255,255,0.35))] focus-visible:bg-[var(--color-bg-interactive-primary,#1a92a4)] focus-visible:border-interactive-neutral focus-visible:before:absolute focus-visible:before:-right-[3px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
      'secondary-outlined':
        "text-interactive-neutral border border-interactive-neutral hover:border-interactive-neutral-hovered hover:text-interactive-neutral-hovered active:border-interactive-neutral-pressed active:text-interactive-neutral-pressed focus-visible:bg-transparent focus-visible:border-interactive bg-transparent focus-visible:before:absolute focus-visible:before:-right-[3px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
      'primary-gradient':
        "text-interactive-on-primary rounded-[4px] border border-interactive-neutral bg-gradient-to-r from-[#111315] to-[#11B9D2] bg-clip-padding hover:border-interactive-neutral-hovered hover:from-[#010305] hover:to-[#01A9C2] active:border-interactive-neutral-pressed active:from-[#111315] active:to-[#11B9D2] hover:text-interactive-on-primary-hovered active:text-interactive-on-primary-pressed focus-visible:before:absolute focus-visible:before:-right-[3px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
      'secondary-text':
        "text-interactive-neutral bg-transparent border-none hover:text-interactive-neutral-hovered active:text-interactive-neutral-pressed rounded-[4px] focus-visible:before:absolute focus-visible:before:-right-[3px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
      'destructive-filled':
        "text-white rounded-[4px] border border-interactive-neutral bg-[#D92D20] hover:bg-[#F04438] hover:border-interactive-neutral-hovered active:bg-[#F97066] active:border-interactive-neutral-pressed focus-visible:bg-[#D92D20] focus-visible:border-interactive-neutral focus-visible:before:absolute focus-visible:before:-right-[3px] focus-visible:before:-top-[3px] focus-visible:before:-bottom-[3px] focus-visible:before:-left-[3px] focus-visible:before:rounded-[4px] focus-visible:before:border focus-visible:before:border-interactive focus-visible:before:content-[''] focus-visible:before:pointer-events-none",
    };

    const sizes = {
      sm: 'text-heading-xs min-h-[32px] max-h-[32px] px-[10px] py-[6px] gap-[4px] rounded',
      md: 'text-heading-xs min-h-[40px] max-h-[40px] px-[14px] py-[10px] gap-[6px] rounded',
      lg: 'text-heading-sm min-h-[48px] max-h-[48px] px-[16px] py-[12px] gap-[8px] rounded',
    };

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ...children.props,
        ref,
        className: classNames(baseStyles, variants[variant], sizes[size], className, children.props.className),
        ...props,
      });
    }

    return (
      <button ref={ref} className={classNames(baseStyles, variants[variant], sizes[size], className)} {...props}>
        {children}
      </button>
    );
  },
);

CustomButton.displayName = 'CustomButton';

export default CustomButton;
export type { CustomButtonProps };
