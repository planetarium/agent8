import React from 'react';
import { classNames } from '~/utils/classNames';

interface ColorTabProps {
  color?: 'gray' | 'cyan' | 'brown' | 'magenta' | 'green';
  size?: 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
}

export const ColorTab: React.FC<ColorTabProps> = ({
  color = 'cyan',
  size = 'md',
  children,
  className,
  onClick,
  disabled = false,
  selected = false,
  ...props
}) => {
  const colorClasses = {
    gray: 'bg-[#374151]',
    cyan: 'bg-[#0D5760]',
    brown: 'bg-[#734D0F]',
    magenta: 'bg-[#811A58]',
    green: 'bg-[#21450F]',
  };

  const sizeClasses = {
    sm: 'min-w-[80px] px-[4px] py-[8px] text-heading-2xs flex-col gap-[4px] flex-[1_0_0]',
    md: 'h-[48px] min-h-[48px] px-[16px] text-heading-sm gap-[8px]',
    lg: 'h-[56px] min-h-[56px] px-[20px] text-heading-sm gap-[8px]',
  };

  return (
    <div
      className={classNames(
        'flex justify-center items-center flex-shrink-0 self-stretch relative',
        'rounded-[8px]',
        'text-interactive-neutral',
        'cursor-pointer',
        'border',
        'hover:elevation-light-3',
        'group',
        colorClasses[color],
        sizeClasses[size],
        className,
      )}
      style={{
        borderColor: selected ? 'rgba(255, 255, 255, 0.35)' : 'transparent',
      }}
      onClick={disabled ? undefined : onClick}
      {...props}
    >
      <div
        className={classNames(
          'absolute left-0 top-0 bottom-0 w-[60px] rounded-l-[8px] transition-opacity duration-200 pointer-events-none',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        style={{
          background: selected
            ? 'radial-gradient(114.29% 100% at 100% 50%, rgba(13, 182, 208, 0.00) 60%, rgba(103, 220, 238, 0.30) 100%)'
            : 'radial-gradient(114.29% 100% at 100% 50%, rgba(13, 182, 208, 0.00) 60%, rgba(103, 220, 238, 0.50) 100%)',
        }}
      />

      <div
        className={classNames(
          'absolute right-0 top-0 bottom-0 w-[60px] rounded-r-[8px] transition-opacity duration-200 pointer-events-none',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        style={{
          background: selected
            ? 'radial-gradient(114.29% 100% at 0% 50%, rgba(13, 182, 208, 0.00) 60%, rgba(103, 220, 238, 0.30) 100%)'
            : 'radial-gradient(114.29% 100% at 0% 50%, rgba(13, 182, 208, 0.00) 60%, rgba(103, 220, 238, 0.50) 100%)',
        }}
      />

      {children}
    </div>
  );
};
