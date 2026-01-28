import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { PreviewIcon } from '~/components/ui/Icons';

interface AnimatedPreviewIconProps {
  size?: number;
}

function IconPreviewPlay({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="block size-full"
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 20 20"
      style={{ width: size, height: size }}
    >
      <g>
        {/* 재생 삼각형만 표시 */}
        <path
          d="M13.0167 9.01429C13.1777 9.12336 13.3096 9.27024 13.4008 9.44208C13.4919 9.61392 13.5396 9.80548 13.5396 10C13.5396 10.1945 13.4919 10.3861 13.4008 10.5579C13.3096 10.7298 13.1777 10.8766 13.0167 10.9857L9.47619 13.3821C9.29709 13.5032 9.08841 13.5732 8.87255 13.5846C8.65668 13.5961 8.44177 13.5485 8.25087 13.4471C8.05998 13.3457 7.90031 13.1942 7.789 13.0088C7.67769 12.8235 7.61894 12.6114 7.61905 12.3952V7.60476C7.61894 7.38859 7.67769 7.17647 7.789 6.99116C7.90031 6.80585 8.05998 6.65434 8.25087 6.5529C8.44177 6.45146 8.65668 6.40391 8.87255 6.41535C9.08841 6.42679 9.29709 6.4968 9.47619 6.61786L13.0167 9.01429Z"
          fill="var(--color-icon-secondary, #F3F5F8)"
        />
      </g>
    </svg>
  );
}

function IconCheck({ size = 20 }: { size?: number }) {
  return (
    <div className="relative shrink-0 transition-opacity duration-500" style={{ width: size, height: size }}>
      <svg className="block size-full" fill="none" viewBox="0 0 20 20">
        <circle
          cx="10"
          cy="10"
          r="9"
          stroke="#99a2b0"
          strokeWidth="2"
          strokeDasharray="56.5"
          strokeDashoffset="56.5"
          strokeLinecap="round"
          style={{
            animation: 'drawCircle 0.6s ease-out forwards',
          }}
        />
        <path
          d="M6 10L9 13L14 7"
          stroke="#12b76a"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="12"
          strokeDashoffset="12"
          style={{
            animation: 'drawCheck 0.4s ease-out 0.4s forwards',
          }}
        />
      </svg>
      <style>{`
        @keyframes drawCircle {
          to {
            stroke-dashoffset: 0;
          }
        }
        @keyframes drawCheck {
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </div>
  );
}

export function AnimatedPreviewIcon({ size = 20 }: AnimatedPreviewIconProps) {
  const isRunningPreview = useStore(workbenchStore.isRunningPreview);
  const [showCheck, setShowCheck] = useState(false);
  const [checkKey, setCheckKey] = useState(0);
  const [wasRunning, setWasRunning] = useState(false);

  useEffect(() => {
    if (isRunningPreview) {
      setWasRunning(true);
      setShowCheck(false);
    } else if (wasRunning && !isRunningPreview) {
      // Preview just finished
      setShowCheck(true);
      setCheckKey((prev) => prev + 1);

      const timer = setTimeout(() => {
        setShowCheck(false);
        setWasRunning(false);
      }, 2000);

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [isRunningPreview, wasRunning]);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {/* 기본 아이콘 - 기존 PreviewIcon 사용 */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          isRunningPreview || showCheck ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <PreviewIcon size={size} className="flex-shrink-0" />
      </div>

      {/* 로딩 상태 (Preview 실행 중) */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${isRunningPreview ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* 재생 삼각형 */}
        <div className="absolute inset-0 z-0">
          <IconPreviewPlay size={size} />
        </div>
        {/* 회전하는 원 - 항상 렌더링 */}
        <svg
          className="animate-spin absolute inset-0 size-full z-10 pointer-events-none"
          fill="none"
          viewBox="0 0 20 20"
        >
          <circle
            cx="10"
            cy="10"
            r="9"
            stroke="rgba(235, 238, 244, 0.5)"
            strokeWidth="2"
            strokeDasharray="56.5"
            strokeDashoffset="14"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* 체크 아이콘 (Preview 완료) */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${showCheck ? 'opacity-100' : 'opacity-0'}`}>
        {showCheck && <IconCheck key={checkKey} size={size} />}
      </div>
    </div>
  );
}
