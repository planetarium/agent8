export default function LoadingSpinnerIcon({ width = 20, height = 20 }: { width?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      className="relative"
    >
      <path
        d="M16.25 10C16.25 6.54869 13.4513 3.75 10 3.75C9.30964 3.75 8.75 3.19036 8.75 2.5C8.75 1.80964 9.30964 1.25 10 1.25C14.832 1.25 18.75 5.16798 18.75 10C18.75 10.6904 18.1904 11.25 17.5 11.25C16.8096 11.25 16.25 10.6904 16.25 10Z"
        fill="white"
        fillOpacity="0.18"
        className="animate-spin"
        style={{
          transformOrigin: 'center',
        }}
      />
      <path
        d="M16.25 10C16.25 6.54869 13.4513 3.75 10 3.75C6.54869 3.75 3.75 6.54869 3.75 10C3.75 13.4513 6.54869 16.25 10 16.25C13.4513 16.25 16.25 13.4513 16.25 10ZM18.75 10C18.75 14.832 14.832 18.75 10 18.75C5.16798 18.75 1.25 14.832 1.25 10C1.25 5.16798 5.16798 1.25 10 1.25C14.832 1.25 18.75 5.16798 18.75 10Z"
        fill="white"
        fillOpacity="0.3"
      />
    </svg>
  );
}
