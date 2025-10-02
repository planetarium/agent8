import React from 'react';

interface MainBackgroundProps {
  className?: string;
  zIndex?: number;
  isMobileView?: boolean;
}

const MainBackground: React.FC<MainBackgroundProps> = ({ className = '', zIndex = 10, isMobileView = false }) => {
  return (
    <div className={`fixed inset-0 pointer-events-none overflow-hidden ${className}`} style={{ zIndex }}>
      {isMobileView ? (
        <img
          src="/background-gradient.webp"
          alt=""
          className="absolute object-cover animate-slide-down"
          style={{
            position: 'absolute',
            top: '-466px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '820px',
            height: '820px',
            opacity: 0.8,
            aspectRatio: '1/1',
            animation: 'slideDown 1s ease-in-out',
          }}
        />
      ) : (
        <div
          style={{
            animation: 'slideDownDesktop 1s ease-in-out',
          }}
        >
          <svg
            className="flex-shrink-0"
            fill="none"
            style={{
              transform: 'translateX(-23%)',
            }}
            viewBox="0 0 1216 936"
            width="1216"
            height="936"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g opacity="0.8" filter="url(#filter0_n_3813_62001)">
              <circle cx="280" r="936" fill="url(#paint0_radial_3813_62001)" />
            </g>
            <defs>
              <filter
                id="filter0_n_3813_62001"
                x="-656"
                y="-936"
                width="1872"
                height="1872"
                filterUnits="userSpaceOnUse"
                color-interpolation-filters="sRGB"
              >
                <feFlood flood-opacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.66666668653488159 0.66666668653488159"
                  stitchTiles="stitch"
                  numOctaves="3"
                  result="noise"
                  seed="9705"
                />
                <feColorMatrix in="noise" type="luminanceToAlpha" result="alphaNoise" />
                <feComponentTransfer in="alphaNoise" result="coloredNoise1">
                  <feFuncA
                    type="discrete"
                    tableValues="0 0 0 0 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 "
                  />
                </feComponentTransfer>
                <feComposite operator="in" in2="shape" in="coloredNoise1" result="noise1Clipped" />
                <feFlood floodColor="rgba(0, 0, 0, 0.3)" result="color1Flood" />
                <feComposite in="color1Flood" in2="noise1Clipped" operator="in" result="color1" />
                <feMerge result="effect1_noise_3813_62001">
                  <feMergeNode in="shape" />
                  <feMergeNode in="color1" />
                </feMerge>
              </filter>
              <radialGradient
                cx="0"
                cy="0"
                gradientTransform="translate(280) rotate(90) scale(936)"
                gradientUnits="userSpaceOnUse"
                id="paint0_radial_3813_62001"
                r="1"
              >
                <stop stopColor="#11B9D2" stopOpacity="0.7" />
                <stop offset="1" stopColor="#FFCB48" stopOpacity="0" />
              </radialGradient>
            </defs>
          </svg>
        </div>
      )}
    </div>
  );
};

export default MainBackground;
