import React from 'react';

interface ArrowTopLineIconProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  fill?: string;
}

export const ArrowTopLineIcon: React.FC<ArrowTopLineIconProps> = ({
  className = '',
  width = 24,
  height = 24,
  fill = '#F3F5F8', // Default fill color
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
      <path
        d="M16.5303 10.5303C16.2374 10.8232 15.7626 10.8232 15.4697 10.5303L12.75 7.81066L12.75 18C12.75 18.4142 12.4142 18.75 12 18.75C11.5858 18.75 11.25 18.4142 11.25 18L11.25 7.81066L8.53033 10.5303C8.23744 10.8232 7.76256 10.8232 7.46967 10.5303C7.17678 10.2374 7.17678 9.76256 7.46967 9.46967L11.4697 5.46967C11.7626 5.17678 12.2374 5.17678 12.5303 5.46967L16.5303 9.46967C16.8232 9.76256 16.8232 10.2374 16.5303 10.5303Z"
        fill={fill}
      />
    </svg>
  );
};
