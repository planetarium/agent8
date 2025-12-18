interface PlayIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function PlayIcon({ size = 14, color = '#F3F5F8', className = '' }: PlayIconProps) {
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
        d="M4.16663 3.47727C4.16663 3.3112 4.20774 3.14834 4.28552 3.00263C4.54107 2.5312 5.11885 2.36085 5.57774 2.62335L17.0111 9.14614C17.1667 9.23507 17.2945 9.36686 17.38 9.5265C17.6356 9.99792 17.4689 10.5926 17.0111 10.854L5.57774 17.3768C5.43861 17.4577 5.27913 17.5003 5.11663 17.5C4.59218 17.5 4.16663 17.0629 4.16663 16.5239V3.47727Z"
        fill={color}
        fillRule="evenodd"
      />
    </svg>
  );
}
