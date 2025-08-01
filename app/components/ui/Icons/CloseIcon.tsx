import React from 'react';

interface CloseIconProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  fill?: string;
}

export const CloseIcon: React.FC<CloseIconProps> = ({ className = '', width = 20, height = 20, fill = '#F3F5F8' }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.0229 6.02217C6.26698 5.77809 6.66271 5.77809 6.90679 6.02217L10.0007 9.11606L13.0946 6.02217C13.3386 5.77809 13.7344 5.77809 13.9785 6.02217C14.2225 6.26625 14.2225 6.66198 13.9785 6.90605L10.8846 9.99994L13.9785 13.0938C14.2225 13.3379 14.2225 13.7336 13.9785 13.9777C13.7344 14.2218 13.3386 14.2218 13.0946 13.9777L10.0007 10.8838L6.90679 13.9777C6.66271 14.2218 6.26698 14.2218 6.0229 13.9777C5.77882 13.7336 5.77882 13.3379 6.0229 13.0938L9.11679 9.99994L6.0229 6.90605C5.77882 6.66198 5.77882 6.26625 6.0229 6.02217Z"
        fill={fill}
      />
    </svg>
  );
};
