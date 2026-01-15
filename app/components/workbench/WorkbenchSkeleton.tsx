import { classNames } from '~/utils/classNames';

interface WorkbenchSkeletonProps {
  isSmallViewport: boolean;
  variant?: 'initial' | 'preparing';
}

export const WorkbenchSkeleton = ({ isSmallViewport, variant = 'initial' }: WorkbenchSkeletonProps) => {
  const topOffset = variant === 'initial' ? '17px' : '0.5rem';

  return (
    <div
      className={classNames('fixed z-20 transition-[left,width] duration-200 bolt-ease-cubic-bezier', {
        'bottom-4.5 mr-4 left-[var(--workbench-left)] w-[var(--workbench-inner-width)]': !isSmallViewport,
      })}
      style={{
        top: !isSmallViewport ? `calc(var(--header-height) + ${topOffset})` : undefined,
      }}
    >
      <div
        className={classNames('absolute inset-0', {
          'pr-7': true,
        })}
      >
        <div
          className={classNames(
            'h-full flex flex-col overflow-hidden relative',
            'border border-tertiary shadow-sm rounded-lg p-4 bg-transperant-subtle',
          )}
        >
          {/* Background overlay to hide workbench content */}
          <div className="absolute inset-0 bg-bolt-elements-background-depth-2 z-10 rounded-lg" />
          {/* Slider skeleton - matches the actual Slider component (Preview, Resource, Code only) */}
          <div className="flex items-center flex-wrap shrink-0 border-secondary w-full bg-bolt-elements-background-depth-1 rounded-lg relative z-20">
            <div className="flex h-10 px-5" />
          </div>

          {/* Preview content skeleton - matches actual Preview component structure */}
          <div className="w-full h-full flex flex-col relative z-20">
            {/* Preview header skeleton - same as actual Preview component */}
            <div className="flex items-center py-3 gap-3">
              {/* Left side - refresh button */}
              <div className="flex items-center bg-bolt-elements-background-depth-1 rounded-lg">
                <div className="w-7 h-7 flex items-center justify-center text-bolt-elements-textTertiary" />
              </div>

              {/* Center - URL bar skeleton */}
              <div className="flex-grow flex items-center gap-1 bg-bolt-elements-preview-addressBar-background text-bolt-elements-preview-addressBar-text rounded-full px-3 py-1 text-sm">
                <div className="w-full h-5 rounded" />
              </div>

              {/* Right side - device controls and additional buttons */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 flex items-center justify-center text-bolt-elements-textTertiary bg-bolt-elements-background-depth-1 rounded-lg" />
                <div className="w-7 h-7 flex items-center justify-center text-bolt-elements-textTertiary bg-bolt-elements-background-depth-1 rounded-lg" />
                <div className="w-7 h-7 flex items-center justify-center text-bolt-elements-textTertiary bg-bolt-elements-background-depth-1 rounded-lg" />
                <div className="ml-2 bg-bolt-elements-background-depth-1 rounded-lg h-8 min-w-[130px] px-3 py-1.5" />
              </div>
            </div>

            {/* Preview content area - matches actual Preview component with proper positioning */}
            <div className="relative flex-1 flex justify-center items-center overflow-hidden preview-container rounded-2xl bg-bolt-elements-background-depth-1" />
          </div>
        </div>
      </div>
    </div>
  );
};
