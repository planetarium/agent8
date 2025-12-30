import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';
import type { ProgressAnnotation } from '~/types/context';
import { classNames } from '~/utils/classNames';
import Lottie from 'lottie-react';
import { loadingAnimationData } from '~/utils/animationData';

// import { cubicEasingFn } from '~/utils/easings';

const textColorAnimation = `
@keyframes textColorWave {
  0% {
    color: var(--color-text-primary, #FFF);
  }
  50% {
    color: #6b7280;
  }
  100% {
    color: var(--color-text-primary, #FFF);
  }
}
`;

export default function ProgressCompilation({ data }: { data?: ProgressAnnotation[] }) {
  const [progressList, setProgressList] = React.useState<ProgressAnnotation[]>([]);
  const clearTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // const [expanded, setExpanded] = useState(false);
  const EXPANDED = false;

  React.useEffect(() => {
    // new data comes in, clear existing timeout
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current);
      clearTimeoutRef.current = null;
    }

    if (!data || data.length == 0) {
      setProgressList([]);
      return;
    }

    const progressMap = new Map<string, ProgressAnnotation>();
    data.forEach((x) => {
      const existingProgress = progressMap.get(x.label);

      if (existingProgress && existingProgress.status === 'complete') {
        return;
      }

      progressMap.set(x.label, x);
    });

    const newData = Array.from(progressMap.values());
    newData.sort((a, b) => a.order - b.order);
    setProgressList(newData);
  }, [data]);

  if (progressList.length === 0) {
    return <></>;
  }

  return (
    <AnimatePresence>
      <div
        className={classNames('border-radius-8 bg-color-bg-transperant', 'relative w-full max-w-chat mx-auto')}
        style={{
          borderRadius: 'var(--border-radius-8, 8px)',
          background: 'var(--color-bg-depth-2, #2A2D33)',
          zIndex: 2,
          position: 'relative',
        }}
      >
        <div
          className={classNames('flex items-center self-stretch')}
          style={{
            padding: 'var(--spacing-12, 12px) var(--spacing-16, 16px)',
            gap: 'var(--spacing-16, 16px)',
          }}
        >
          <div className="flex-1">
            <AnimatePresence>
              {EXPANDED ? (
                <motion.div
                  className="actions"
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: '0px' }}
                  transition={{ duration: 0.15 }}
                >
                  {progressList.map((x, i) => {
                    return <ProgressItem key={i} progress={x} />;
                  })}
                </motion.div>
              ) : (
                <ProgressItem progress={progressList.slice(-1)[0]} />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AnimatePresence>
  );
}

const ProgressItem = ({ progress }: { progress: ProgressAnnotation }) => {
  const textColorWaveStyle =
    progress.status === 'in-progress'
      ? ({
          animation: 'textColorWave 2s ease-in-out infinite',
        } as React.CSSProperties)
      : {};

  return (
    <>
      {progress.status === 'in-progress' && <style>{textColorAnimation}</style>}
      <motion.div
        className={classNames('flex text-sm gap-3 text-bolt-elements-item-contentAccent')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{ position: 'relative', zIndex: 2 }}
      >
        <div className="flex items-center gap-1.5">
          <div>
            {progress.status === 'in-progress' ? (
              <div style={{ width: '24px', height: '24px' }}>
                <Lottie animationData={loadingAnimationData} loop={true} />
              </div>
            ) : progress.status === 'complete' ? (
              <img src="/icons/CheckCircle.svg" alt="Complete" />
            ) : null}
          </div>
        </div>
        {progress.status === 'in-progress' ? (
          <div
            className="mt-[2px] font-primary font-feature-stylistic text-[14px] font-semibold leading-[142.9%]"
            style={textColorWaveStyle}
          >
            {progress.message}
          </div>
        ) : (
          <div className="mt-[2px] font-primary font-feature-stylistic text-[var(--color-text-primary,#FFF)] text-[14px] font-semibold leading-[142.9%]">
            {progress.message}
          </div>
        )}
      </motion.div>
    </>
  );
};
