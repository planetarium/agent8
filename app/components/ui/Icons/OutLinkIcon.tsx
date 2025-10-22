import React from 'react';

interface OutLinkIconProps {
  size?: number;
  className?: string;
  fill?: string;
}

export const OutLinkIcon: React.FC<OutLinkIconProps> = ({ size = 20, className = '', fill = '#F3F5F8' }) => {
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
        d="M8.125 7.08301C7.77982 7.08301 7.5 6.80319 7.5 6.45801C7.5 6.11283 7.77982 5.83301 8.125 5.83301H12.2917C12.6368 5.83301 12.9167 6.11283 12.9167 6.45801V10.6247C12.9167 10.9699 12.6368 11.2497 12.2917 11.2497C11.9465 11.2497 11.6667 10.9699 11.6667 10.6247V7.96689L6.06694 13.5666C5.82286 13.8107 5.42714 13.8107 5.18306 13.5666C4.93898 13.3225 4.93898 12.9268 5.18306 12.6827L10.7828 7.08301H8.125Z"
        fill={fill}
      />
    </svg>
  );
};
