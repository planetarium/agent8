import React from 'react';

interface PlayCircleIconProps {
  size?: number;
  className?: string;
  color?: string;
}

export const PlayCircleIcon: React.FC<PlayCircleIconProps> = ({ size = 100, className, color = 'currentColor' }) => {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 100 100"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g opacity="0.2">
        <path
          d="M37.7971 30.562C38.436 29.2529 39.8808 28.7794 41.0279 29.5081L69.6127 47.6274C70.0012 47.8745 70.3185 48.2422 70.5323 48.6854C71.1708 49.9945 70.7563 51.6455 69.6127 52.3719L41.0279 70.4912C40.6804 70.7157 40.2821 70.8337 39.8763 70.833C38.5656 70.833 37.5007 69.6194 37.5 68.123V31.8804C37.5001 31.4193 37.6027 30.9666 37.7971 30.562Z"
          fill={color}
        />
        <path
          clipRule="evenodd"
          d="M50 5.20801C74.7384 5.20801 94.7917 25.2613 94.7917 49.9997C94.7917 74.7381 74.7384 94.7913 50 94.7913C25.2617 94.7913 5.20837 74.7381 5.20837 49.9997C5.20837 25.2613 25.2617 5.20801 50 5.20801ZM50 11.458C28.7134 11.458 11.4584 28.7131 11.4584 49.9997C11.4584 71.2863 28.7134 88.5413 50 88.5413C71.2866 88.5413 88.5417 71.2863 88.5417 49.9997C88.5417 28.7131 71.2866 11.458 50 11.458Z"
          fill={color}
          fillRule="evenodd"
        />
      </g>
    </svg>
  );
};
