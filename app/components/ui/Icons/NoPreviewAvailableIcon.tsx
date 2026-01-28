interface NoPreviewAvailableIconProps {
  size?: number;
  className?: string;
}

export function NoPreviewAvailableIcon({ size = 256, className = '' }: NoPreviewAvailableIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={(size * 172) / 256}
      viewBox="0 0 256 172"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_9056_181681)">
        <g clipPath="url(#clip1_9056_181681)">
          <rect y="-0.481934" width="256" height="172" rx="12" fill="#111315" />
          <rect
            x="1"
            y="0.518066"
            width="254"
            height="170"
            rx="11"
            stroke="white"
            strokeOpacity="0.12"
            strokeWidth="2"
          />
          <path
            d="M231.225 16.718C231.225 14.3432 233.073 12.418 235.354 12.418H239.483C241.763 12.418 243.612 14.3432 243.612 16.718V21.018C243.612 23.3928 241.763 25.318 239.483 25.318H235.354C233.073 25.318 231.225 23.3928 231.225 21.018V16.718Z"
            fill="white"
            fillOpacity="0.12"
          />
          <path
            d="M210.58 16.718C210.58 14.3432 212.429 12.418 214.709 12.418H218.838C221.118 12.418 222.967 14.3432 222.967 16.718V21.018C222.967 23.3928 221.118 25.318 218.838 25.318H214.709C212.429 25.318 210.58 23.3928 210.58 21.018V16.718Z"
            fill="white"
            fillOpacity="0.12"
          />
          <path
            d="M189.936 16.718C189.936 14.3432 191.784 12.418 194.065 12.418H198.194C200.474 12.418 202.323 14.3432 202.323 16.718V21.018C202.323 23.3928 200.474 25.318 198.194 25.318H194.065C191.784 25.318 189.936 23.3928 189.936 21.018V16.718Z"
            fill="white"
            fillOpacity="0.12"
          />
          <path d="M2.06445 38.2183H253.935" stroke="white" strokeOpacity="0.12" strokeWidth="2" />
        </g>
        <path
          d="M127.667 75C142.333 75 154.333 87 154.333 101.667C154.333 116.333 142.333 128.333 127.667 128.333C113 128.333 101 116.333 101 101.667C101 87 113 75 127.667 75ZM127.667 80.3333C122.6 80.3333 118.067 81.9333 114.6 84.8667L144.467 114.733C147.133 111 149 106.467 149 101.667C149 89.9333 139.4 80.3333 127.667 80.3333ZM140.733 118.467L110.867 88.6C107.933 92.0667 106.333 96.6 106.333 101.667C106.333 113.4 115.933 123 127.667 123C132.733 123 137.267 121.4 140.733 118.467Z"
          fill="#3D3F42"
        />
      </g>
      <defs>
        <clipPath id="clip0_9056_181681">
          <rect width="256" height="172" fill="white" />
        </clipPath>
        <clipPath id="clip1_9056_181681">
          <rect width="256" height="172" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
