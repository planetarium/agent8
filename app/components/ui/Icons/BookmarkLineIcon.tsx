import React from 'react';

interface BookmarkLineIconProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  fill?: string;
}

export const BookmarkLineIcon: React.FC<BookmarkLineIconProps> = ({
  className = '',
  width = 24,
  height = 24,
  fill = 'currentColor',
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
        d="M18.2998 4.21982C18.2999 4.08175 18.2712 3.9955 18.1445 3.87217C18.0164 3.7472 17.9027 3.7003 17.7138 3.7003H6.28799L6.1581 3.71006C6.04075 3.72944 5.95306 3.77936 5.85635 3.87314C5.73018 3.9956 5.7001 4.08237 5.7001 4.22275V19.4494L11.9999 16.8253L18.2998 19.4494V4.21982ZM19.9999 22.0001L11.9999 18.6671L3.99992 22.0001V4.22275C3.99992 3.61166 4.22374 3.08822 4.6717 2.65342C5.11966 2.21862 5.65815 2.00085 6.28655 2.0001H17.7137C18.3428 2.0001 18.8809 2.21794 19.3289 2.65342C19.7769 3.08851 19.9999 3.61198 19.9999 4.22275V22.0001Z"
        fill={fill}
      />
    </svg>
  );
};
