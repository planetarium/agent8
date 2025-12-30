import React from 'react';

interface EditIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const EditIcon: React.FC<EditIconProps> = ({ size = 24, color = '#F3F5F8', className = '' }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M21 20.1504C21.4694 20.1504 21.8496 20.5306 21.8496 21C21.8496 21.4695 21.4694 21.8496 21 21.8496H3C2.53056 21.8496 2.15039 21.4695 2.15039 21C2.1504 20.5306 2.53056 20.1504 3 20.1504H21Z"
        fill={color}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16.4639 2.34083C16.7977 2.06864 17.2894 2.08827 17.6006 2.39943L21.6006 6.39943C21.9325 6.73137 21.9325 7.26865 21.6006 7.6006L11.6006 17.6006C11.4412 17.76 11.2254 17.8496 11 17.8496H7C6.53056 17.8496 6.15039 17.4695 6.15039 17V13C6.1504 12.7746 6.24001 12.5588 6.39941 12.3994L16.3994 2.39943L16.4639 2.34083ZM7.84961 13.3516V16.1504H10.6484L16.7988 10L14 7.20118L7.84961 13.3516ZM15.2012 6.00001L18 8.79884L19.7988 7.00001L17 4.20118L15.2012 6.00001Z"
        fill={color}
      />
    </svg>
  );
};

export default EditIcon;
