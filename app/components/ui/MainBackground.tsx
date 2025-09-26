import React from 'react';

interface MainBackgroundProps {
  className?: string;
  zIndex?: number;
  isMobileView?: boolean;
}

const MainBackground: React.FC<MainBackgroundProps> = ({ className = '', zIndex = 10, isMobileView = false }) => {
  return (
    <div className={`fixed inset-0 pointer-events-none overflow-hidden ${className}`} style={{ zIndex }}>
      <svg
        className="flex-shrink-0"
        fill="none"
        height="1428"
        style={{
          position: 'absolute',
          top: '-50%',
          left: isMobileView ? '50%' : '0%',
          transform: 'translateX(-50%)',
        }}
        viewBox="0 0 1528 765"
        width="1428"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g filter="url(#filter0_n_443_2422)" opacity="0.6">
          <circle cx="764" cy="1" fill="url(#paint0_radial_443_2422)" r="764" />
        </g>
        <defs>
          <filter
            colorInterpolationFilters="sRGB"
            filterUnits="userSpaceOnUse"
            height="1528"
            id="filter0_n_443_2422"
            width="1528"
            x="0"
            y="-763"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend in="SourceGraphic" in2="BackgroundImageFix" mode="normal" result="shape" />
            <feTurbulence
              baseFrequency="0.66666668653488159 0.66666668653488159"
              numOctaves="3"
              result="noise"
              seed="9705"
              stitchTiles="stitch"
              type="fractalNoise"
            />
            <feColorMatrix in="noise" result="alphaNoise" type="luminanceToAlpha" />
            <feComponentTransfer in="alphaNoise" result="coloredNoise1">
              <feFuncA
                tableValues="0 0 0 0 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0"
                type="discrete"
              />
            </feComponentTransfer>
            <feComposite in="coloredNoise1" in2="shape" operator="in" result="noise1Clipped" />
            <feFlood floodColor="rgba(0, 0, 0, 0.8)" result="color1Flood" />
            <feComposite in="color1Flood" in2="noise1Clipped" operator="in" result="color1" />
            <feMerge result="effect1_noise_443_2422">
              <feMergeNode in="shape" />
              <feMergeNode in="color1" />
            </feMerge>
          </filter>
          <radialGradient
            cx="0"
            cy="0"
            gradientTransform="translate(764 1) rotate(90) scale(764)"
            gradientUnits="userSpaceOnUse"
            id="paint0_radial_443_2422"
            r="1"
          >
            <stop stopColor="#11B9D2" stopOpacity="0.5" />
            <stop offset="1" stopColor="#FFCB48" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
};

export default MainBackground;
