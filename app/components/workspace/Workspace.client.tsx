import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { memo, useCallback, useState, useEffect } from 'react';
import { ActionRunner } from '~/lib/runtime/action-runner';

import { Slider } from '~/components/ui/Slider';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import useViewport from '~/lib/hooks';
import { TaskList, type GitlabIssue } from './TaskList.client';
import { WorkbenchV2 } from '~/components/workbench/WorkbenchV2.client';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  actionRunner: ActionRunner;

  // Task-related props
  selectedTaskId?: string;
  onTaskSelect?: (task: GitlabIssue | null) => void;
}

type WorkspaceViewType = 'tasks' | 'workbench';

const workspaceVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

const viewTransition = { ease: cubicEasingFn };

interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});

const sliderOptions = [
  {
    value: 'tasks' as WorkspaceViewType,
    text: 'Tasks',
  },
  {
    value: 'workbench' as WorkspaceViewType,
    text: 'Workbench',
  },
];

export const Workspace = memo(
  ({ chatStarted, isStreaming, actionRunner, selectedTaskId, onTaskSelect }: WorkspaceProps) => {
    const [selectedView, setSelectedView] = useState<WorkspaceViewType>('tasks');
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const isSmallViewport = useViewport(1024);

    const handleTaskSelect = useCallback(
      (task: GitlabIssue | null) => {
        onTaskSelect?.(task);
      },
      [onTaskSelect],
    );

    // Clear task selection when switching away from tasks view
    useEffect(() => {
      if (selectedView !== 'tasks' && selectedTaskId) {
        onTaskSelect?.(null);
      }
    }, [selectedView, selectedTaskId, onTaskSelect]);

    return (
      chatStarted && (
        <motion.div
          initial="closed"
          animate={showWorkbench ? 'open' : 'closed'}
          variants={workspaceVariants}
          className="z-workbench"
        >
          <div
            className={classNames(
              'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
              {
                'w-full': isSmallViewport,
                'left-0': showWorkbench && isSmallViewport,
                'left-[var(--workbench-left)]': showWorkbench,
                'left-[100%]': !showWorkbench,
              },
            )}
          >
            <div className="absolute inset-0 px-2 lg:px-6">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
                {/* Header with Slider - Always visible */}
                <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor flex-shrink-0">
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />

                  <div className="ml-auto" />
                </div>

                {/* Content area with views */}
                <div className="relative flex-1 overflow-hidden">
                  {/* Tasks View */}
                  <View
                    initial={{ x: selectedView === 'tasks' ? 0 : '-100%' }}
                    animate={{ x: selectedView === 'tasks' ? 0 : '-100%' }}
                  >
                    <TaskList selectedTaskId={selectedTaskId} onTaskSelect={handleTaskSelect} />
                  </View>

                  {/* Workbench View */}
                  <View
                    initial={{ x: selectedView === 'workbench' ? 0 : '100%' }}
                    animate={{ x: selectedView === 'workbench' ? 0 : '100%' }}
                  >
                    <WorkbenchV2 chatStarted={chatStarted} isStreaming={isStreaming} actionRunner={actionRunner} />
                  </View>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )
    );
  },
);
