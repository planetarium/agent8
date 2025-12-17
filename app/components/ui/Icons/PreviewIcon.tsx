interface PreviewIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function PreviewIcon({ size = 20, color = '#F3F5F8', className }: PreviewIconProps) {
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
        d="M2.50008 2.5H17.5001C17.7211 2.5 17.9331 2.5878 18.0893 2.74408C18.2456 2.90036 18.3334 3.11232 18.3334 3.33333V16.6667C18.3334 16.8877 18.2456 17.0996 18.0893 17.2559C17.9331 17.4122 17.7211 17.5 17.5001 17.5H2.50008C2.27907 17.5 2.06711 17.4122 1.91083 17.2559C1.75455 17.0996 1.66675 16.8877 1.66675 16.6667V3.33333C1.66675 3.11232 1.75455 2.90036 1.91083 2.74408C2.06711 2.5878 2.27907 2.5 2.50008 2.5ZM16.6667 8.33333H3.33341V15.8333H16.6667V8.33333ZM4.16675 5V6.66667H5.83341V5H4.16675ZM7.50008 5V6.66667H9.16675V5H7.50008Z"
        fill={color}
      />
    </svg>
  );
}
