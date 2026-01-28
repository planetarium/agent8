import { memo } from 'react';
import Lottie from 'lottie-react';
import { Code2 } from 'lucide-react';

import svgPaths from '~/components/ui/Icons/paths/previewLoadingSvgPaths';
import { starAnimationData } from '~/utils/animationData';

interface CodeGenLoadingIconProps {
  size?: number;
  className?: string;
}

function CodeGenLoadingImage() {
  const codeLines = [
    [
      { text: 'const', color: '#C792EA' },
      { text: ' game = ', color: '#D6DEEB' },
      { text: 'new', color: '#C792EA' },
      { text: ' Game();', color: '#D6DEEB' },
    ],
    [
      { text: 'function', color: '#C792EA' },
      { text: ' ', color: '#D6DEEB' },
      { text: 'update', color: '#82AAFF' },
      { text: '() {', color: '#D6DEEB' },
    ],
    [
      { text: '  player.', color: '#D6DEEB' },
      { text: 'move', color: '#82AAFF' },
      { text: '();', color: '#D6DEEB' },
    ],
    [
      { text: '  ', color: '#D6DEEB' },
      { text: 'checkCollision', color: '#82AAFF' },
      { text: '();', color: '#D6DEEB' },
    ],
    [{ text: '}', color: '#D6DEEB' }],
    [
      { text: 'render', color: '#82AAFF' },
      { text: '(scene);', color: '#D6DEEB' },
    ],
    [
      { text: 'export default', color: '#C792EA' },
      { text: ' app;', color: '#D6DEEB' },
    ],
    [
      { text: 'import', color: '#C792EA' },
      { text: ' { Engine } ', color: '#D6DEEB' },
      { text: 'from', color: '#C792EA' },
      { text: ' ', color: '#D6DEEB' },
      { text: "'core'", color: '#C3E88D' },
      { text: ';', color: '#D6DEEB' },
    ],
  ];

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

          <foreignObject x="15" y="12" width="226" height="118" opacity="0.6">
            <div className="code-scroll-container">
              <div className="code-scroll-content">
                {[...codeLines, ...codeLines].map((line, index) => (
                  <div key={index} className="code-line">
                    {line.map((segment, segIndex) => (
                      <span key={segIndex} className="code-segment" style={{ color: segment.color }}>
                        {segment.text}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
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
      <div className="flex items-center gap-2 absolute bottom-[16px] left-1/2 -translate-x-1/2 z-10">
        <Code2 size={20} color="#767d8c" />
        <p
          className="font-primary font-medium leading-[1.5] text-[16px] whitespace-nowrap text-shimmer"
          style={{
            fontVariationSettings: "'wdth' 100",
          }}
        >
          Building your game
        </p>
      </div>
    </div>
  );
}

export const CodeGenLoadingIcon = memo(({ size = 256, className = '' }: CodeGenLoadingIconProps) => {
  return (
    <div
      className={`content-stretch flex gap-[10px] items-center relative ${className}`}
      style={{ width: size, height: (size * 172) / 256 }}
      data-name="Code Gen Loading"
    >
      <CodeGenLoadingImage />
      <Component />
    </div>
  );
});

CodeGenLoadingIcon.displayName = 'CodeGenLoadingIcon';
