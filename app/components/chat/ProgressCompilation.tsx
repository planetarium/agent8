import { AnimatePresence, motion } from 'framer-motion';
import React, { useState, useEffect } from 'react';
import type { ProgressAnnotation } from '~/types/context';
import { classNames } from '~/utils/classNames';
import Lottie from 'lottie-react';

// import { cubicEasingFn } from '~/utils/easings';

const textColorAnimation = `
@keyframes textColorWave {
  0% {
    color: var(--color-text-primary, #FFF);
  }
  50% {
    color: #3FD2E8;
  }
  100% {
    color: var(--color-text-primary, #FFF);
  }
}
`;

export default function ProgressCompilation({ data }: { data?: ProgressAnnotation[] }) {
  const [progressList, setProgressList] = React.useState<ProgressAnnotation[]>([]);

  // const [expanded, setExpanded] = useState(false);
  const EXPANDED = false;

  React.useEffect(() => {
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
        className={classNames('border-radius-8 bg-color-bg-transperant', 'relative w-full max-w-chat mx-auto z-prompt')}
        style={{
          borderRadius: 'var(--border-radius-8, 8px)',
          background: 'var(--color-bg-depth-2, #2A2D33)',
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
          {/* <motion.button
            initial={{ width: 0 }}
            animate={{ width: 'auto' }}
            exit={{ width: 0 }}
            transition={{ duration: 0.15, ease: cubicEasingFn }}
            className="rounded-lg hover:bg-bolt-elements-artifacts-backgroundHover"
            onClick={() => setExpanded((v) => !v)}
          >
            <div className={expanded ? 'i-ph:caret-up-bold' : 'i-ph:caret-down-bold'}></div>
          </motion.button> */}
        </div>
      </div>
    </AnimatePresence>
  );
}

const ProgressItem = ({ progress }: { progress: ProgressAnnotation }) => {
  const [animationData, setAnimationData] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && progress.status === 'in-progress') {
      fetch('/animations/loading.json')
        .then((response) => response.json())
        .then((data) => setAnimationData(data))
        .catch((error) => console.error('animation load error:', error));
    }
  }, [progress.status]);

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
      >
        <div className="flex items-center gap-1.5">
          <div>
            {progress.status === 'in-progress' ? (
              animationData ? (
                <div style={{ width: '24px', height: '24px' }}>
                  <Lottie animationData={animationData} loop={true} />
                </div>
              ) : (
                <div className="i-svg-spinners:90-ring-with-bg ml-[10px] mt-1"></div>
              )
            ) : progress.status === 'complete' ? (
              <img src="/icons/CheckCircle.svg" alt="Complete" />
            ) : null}
          </div>
          {/* {x.label} */}
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
