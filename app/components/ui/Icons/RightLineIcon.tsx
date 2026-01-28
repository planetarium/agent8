interface RightLineIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function RightLineIcon({ size = 20, color = '#F3F5F8', className = '' }: RightLineIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 20 20"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.2247 6.22505C11.4688 5.98097 11.8645 5.98097 12.1086 6.22505L15.4419 9.55838C15.686 9.80246 15.686 10.1982 15.4419 10.4423L12.1086 13.7756C11.8645 14.0197 11.4688 14.0197 11.2247 13.7756C10.9806 13.5315 10.9806 13.1358 11.2247 12.8917L13.4911 10.6253H5C4.65482 10.6253 4.375 10.3455 4.375 10.0003C4.375 9.65515 4.65482 9.37533 5 9.37533H13.4911L11.2247 7.10893C10.9806 6.86486 10.9806 6.46913 11.2247 6.22505Z"
        fill={color}
      />
    </svg>
  );
}
