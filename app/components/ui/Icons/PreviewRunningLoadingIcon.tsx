import { memo, useState, useEffect } from 'react';
import Lottie from 'lottie-react';
import { IoPlay } from 'react-icons/io5';

import svgPaths from '~/components/ui/Icons/paths/previewLoadingSvgPaths';
import { starAnimationData } from '~/utils/animationData';

// Isometric cube dimensions
const CUBE_SIZE = 20;
const ISO_WIDTH = CUBE_SIZE * Math.sqrt(3);
const ISO_HEIGHT = CUBE_SIZE;

// Color palettes
const COLORS = {
  white: {
    top: '#111315',
    left: '#111315',
    right: '#111315',
  },
  cyan: {
    top: '#72E7F8',
    left: '#5ACCDD',
    right: '#4AB8C8',
  },
  pink: {
    top: '#111315',
    left: '#111315',
    right: '#111315',
  },
  blue: {
    top: '#111315',
    left: '#111315',
    right: '#111315',
  },
  lime: {
    top: '#111315',
    left: '#111315',
    right: '#111315',
  },
};

interface IsoCubeProps {
  x: number;
  y: number;
  z: number;
  color: 'white' | 'cyan' | 'pink' | 'blue' | 'lime';
}

function IsoCube({ x, y, z, color }: IsoCubeProps) {
  // Calculate isometric position
  const pixelX = (x - y) * (ISO_WIDTH / 2);
  const pixelY = (x + y) * (ISO_HEIGHT / 2) - z * ISO_HEIGHT;

  const colors = COLORS[color] || COLORS.white; // Fallback to white if color is invalid

  // Calculate distance from center (1.5, 1.5) for glow effect
  const centerX = 1.5;
  const centerY = 1.5;
  const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
  const maxDistance = Math.sqrt(2 * Math.pow(2, 2)); // Max distance in 4x4 grid from center
  const normalizedDistance = Math.min(distance / maxDistance, 1);

  // Bright in center (0.9), dim at edges (0.15)
  const opacity = 0.9 - normalizedDistance * 0.75;

  return (
    <g transform={`translate(${pixelX}, ${pixelY})`}>
      {/* Top face */}
      <path
        d={`M 0,0 L ${ISO_WIDTH / 2},${-ISO_HEIGHT / 2} L ${ISO_WIDTH},0 L ${ISO_WIDTH / 2},${ISO_HEIGHT / 2} Z`}
        fill={colors.top}
        stroke={`rgba(255,255,255,${opacity})`}
        strokeWidth="1"
      />
      {/* Left face */}
      <path
        d={`M 0,0 L ${ISO_WIDTH / 2},${ISO_HEIGHT / 2} L ${ISO_WIDTH / 2},${ISO_HEIGHT * 1.5} L 0,${ISO_HEIGHT} Z`}
        fill={colors.left}
        stroke={`rgba(255,255,255,${opacity})`}
        strokeWidth="1"
      />
      {/* Right face */}
      <path
        d={`M ${ISO_WIDTH},0 L ${ISO_WIDTH / 2},${ISO_HEIGHT / 2} L ${ISO_WIDTH / 2},${ISO_HEIGHT * 1.5} L ${ISO_WIDTH},${ISO_HEIGHT} Z`}
        fill={colors.right}
        stroke={`rgba(255,255,255,${opacity})`}
        strokeWidth="1"
      />
    </g>
  );
}

function IsoCubeTower() {
  const [cubes, setCubes] = useState<IsoCubeProps[]>([]);
  const [cameraOffset, setCameraOffset] = useState(ISO_HEIGHT * 2);

  useEffect(() => {
    const colorOptions: Array<'white' | 'cyan' | 'pink' | 'blue' | 'lime'> = [
      'white',
      'white',
      'white',
      'white',
      'white',
      'white',
      'white',
      'white',
      'white',
      'cyan',
    ];

    // Generate random positions for 6 cubes in 4x4 grid
    const generateRandomPositions = () => {
      const positions: Array<{ x: number; y: number }> = [];

      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          positions.push({ x, y });
        }
      }

      // Shuffle and take first 6
      return positions.sort(() => Math.random() - 0.5).slice(0, 6);
    };

    // Initialize with 2 layers already stacked
    let currentLayer = 2;
    let allCubes: IsoCubeProps[] = [];

    // Create initial 2 layers
    for (let z = 0; z < 2; z++) {
      const positions = generateRandomPositions();
      const layerCubes = positions.map((pos) => ({
        x: pos.x,
        y: pos.y,
        z,
        color: colorOptions[Math.floor(Math.random() * colorOptions.length)] as
          | 'white'
          | 'cyan'
          | 'pink'
          | 'blue'
          | 'lime',
      }));

      allCubes = [...allCubes, ...layerCubes];
    }

    setCubes(allCubes);

    // Timing constants
    const LAYER_INTERVAL = 700; // milliseconds per layer

    // Add new layer every LAYER_INTERVAL ms
    const interval = setInterval(() => {
      // Generate new layer positions
      const currentPositions = generateRandomPositions();

      // Add all cubes for this layer at once
      const newLayerCubes = currentPositions.map((pos) => ({
        x: pos.x,
        y: pos.y,
        z: currentLayer,
        color: colorOptions[Math.floor(Math.random() * colorOptions.length)] as
          | 'white'
          | 'cyan'
          | 'pink'
          | 'blue'
          | 'lime',
      }));

      allCubes = [...allCubes, ...newLayerCubes];

      // Remove cubes that are too far below (optimization: keep only ~8 layers)
      const minVisibleZ = currentLayer - 8;

      allCubes = allCubes.filter((cube) => cube.z >= minVisibleZ);

      setCubes(allCubes);

      // Update camera position - CSS will handle smooth transition
      setCameraOffset(ISO_HEIGHT * 2 + (currentLayer - 2) * ISO_HEIGHT);

      // Move to next level
      currentLayer++;
    }, LAYER_INTERVAL);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <svg
      className="absolute"
      style={{
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: '220px',
        height: '200px',
        opacity: 0.5,
      }}
      viewBox="-70 -50 180 150"
    >
      <g
        style={{
          transform: `translate(0px, ${cameraOffset}px)`,
          transition: 'transform 700ms linear',
        }}
      >
        {cubes.map((cube, index) => (
          <IsoCube key={`${cube.x}-${cube.y}-${cube.z}-${index}`} {...cube} />
        ))}
      </g>
    </svg>
  );
}

function CodeGenLoadingImage() {
  return (
    <div className="absolute h-[172px] left-0 top-0 w-[256px] overflow-hidden z-0" data-name="Code Gen Loading Image">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 256 172">
        <g clipPath="url(#clip0_1_113)" id="Code Gen Loading Image">
          <path d={svgPaths.p5c7a400} fill="var(--fill-0, #111315)" id="Vector" />
          <g id="Mask group">
            <mask
              height="172"
              id="mask0_1_113"
              maskUnits="userSpaceOnUse"
              style={{ maskType: 'luminance' }}
              width="256"
              x="0"
              y="0"
            >
              <g id="Group">
                <path d={svgPaths.p5c7a400} fill="var(--fill-0, white)" id="Vector_2" />
              </g>
            </mask>
            <g mask="url(#mask0_1_113)">
              <path d={svgPaths.p26c23e00} fill="var(--fill-0, white)" fillOpacity="0.12" id="Vector_3" />
            </g>
          </g>

          {/* Isometric cubes tower */}
          <foreignObject x="2" y="8" width="252" height="122">
            <div className="w-full h-full overflow-hidden rounded-[14px] relative">
              <IsoCubeTower />
              {/* Top gradient fade */}
              <div className="absolute top-0 left-0 w-full h-8 bg-gradient-to-b from-[#111315] to-transparent pointer-events-none z-10"></div>
              {/* Bottom gradient fade */}
              <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-[#111315] to-transparent pointer-events-none z-10"></div>
            </div>
          </foreignObject>
        </g>
        <defs>
          <clipPath id="clip0_1_113">
            <rect fill="white" height="172" width="256" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Component() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col h-[172px] items-center min-h-px min-w-px pb-0 px-0 relative z-10">
      <div
        className="absolute top-[50px] left-1/2 -translate-x-1/2 shrink-0 size-[48px]"
        data-name="🟢 https://lottiefiles.com/animations/star-magic-WuyWHy4AEJ"
        style={{
          filter:
            'drop-shadow(0 0 8px rgba(114, 231, 248, 0.6)) drop-shadow(0 0 12px rgba(114, 231, 248, 0.4)) brightness(1.3) contrast(1.2)',
        }}
      >
        <Lottie animationData={starAnimationData} loop={true} />
      </div>
      <p
        className="font-['Instrument_Sans:Medium',sans-serif] font-medium leading-[1.5] text-[16px] whitespace-nowrap text-shimmer absolute bottom-[16px] left-1/2 -translate-x-1/2 z-10 flex items-center gap-2"
        style={{
          fontVariationSettings: "'wdth' 100",
        }}
      >
        <IoPlay className="size-4 fill-current" />
        Running Preview
      </p>
    </div>
  );
}

export const PreviewRunningLoadingIcon = memo(({ size = 256, className = '' }: PreviewRunningLoadingIconProps) => {
  return (
    <div
      className={`content-stretch flex gap-[10px] items-center relative ${className}`}
      style={{ width: size, height: (size * 172) / 256 }}
      data-name="Preview Running Loading"
    >
      <CodeGenLoadingImage />
      <Component />
    </div>
  );
});

interface PreviewRunningLoadingIconProps {
  size?: number;
  className?: string;
}

PreviewRunningLoadingIcon.displayName = 'PreviewRunningLoadingIcon';
