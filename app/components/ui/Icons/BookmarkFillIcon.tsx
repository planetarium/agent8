interface BookmarkFillIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function BookmarkFillIcon({ size = 20, color = 'currentColor', className = '' }: BookmarkFillIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
    >
      <path
        d="M4.1665 17.5V4.16667C4.1665 3.70833 4.32984 3.31611 4.6565 2.99C4.98317 2.66389 5.37539 2.50056 5.83317 2.5H14.1665C14.6248 2.5 15.0173 2.66333 15.344 2.99C15.6707 3.31667 15.8337 3.70889 15.8332 4.16667V17.5L9.99984 15L4.1665 17.5Z"
        fill={color}
      />
    </svg>
  );
}
