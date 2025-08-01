import React from 'react';

interface ShareFillIconProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  fill?: string;
}

export const ShareFillIcon: React.FC<ShareFillIconProps> = ({
  className = '',
  width = 24,
  height = 24,
  fill = '#F3F5F8',
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path d="M13 2L22 11L13 19.5V14C6 14 3 21.5 3 21.5C3 13 5.5 7.5 13 7.5V2Z" fill={fill} />
    </svg>
  );
};
