import type { Message } from 'ai';
import { forwardRef, useState, useEffect } from 'react';
import type { ForwardedRef } from 'react';
import { Messages } from './Messages.client';
import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { mergeTaskBranch } from '~/lib/persistenceGitbase/api.client';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';

interface TaskMessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  taskBranches?: any[];
  currentTaskBranch?: any;
  reloadTaskBranches?: (projectPath: string) => void;
  messages?: Message[];
  onRetry?: (message: Message) => void;
  onFork?: (message: Message) => void;
  onRevert?: (message: Message) => void;
  onViewDiff?: (message: Message) => void;
}

export const TaskMessages = forwardRef<HTMLDivElement, TaskMessagesProps>(
  (props: TaskMessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { className, taskBranches, reloadTaskBranches, isStreaming, ...otherProps } = props;
    const [isLoading, setIsLoading] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [reloadCount, setReloadCount] = useState(0);

    const repo = useStore(repoStore);
    const currentTaskBranch = repo.taskBranch;

    // Find the current branch info
    const branch = taskBranches?.find((branch) => branch.name === currentTaskBranch);
    const mergeStatus = branch?.mergeStatus;

    useEffect(() => {
      let intervalId: NodeJS.Timeout;

      if (!isStreaming && (!mergeStatus || mergeStatus !== 'can_be_merged')) {
        if (reloadCount < 2) {
          setIsLoading(true);
        }

        intervalId = setInterval(() => {
          reloadTaskBranches?.(repo.path);

          if (mergeStatus) {
            setReloadCount((prevCount) => prevCount + 1);
          }

          if (reloadCount >= 2) {
            setIsLoading(false);
          }
        }, 2000);
      } else {
        setIsLoading(false);
      }

      return () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    }, [mergeStatus, reloadTaskBranches, repo.path, reloadCount, isStreaming]);

    const isProcessing = isLoading || isStreaming;

    return (
      <div
        className={classNames(
          'relative flex flex-col w-full',
          'bg-gradient-to-b from-cyan-50/5 to-transparent',
          className,
        )}
      >
        {/* Task header */}
        <div className="sticky top-0 z-10 bg-black">
          <div
            className={classNames(
              'flex w-full flex-1 max-w-chat mx-auto max-h-22 rounded-lg border p-4 shadow-md backdrop-blur-sm transition-all hover:border-cyan-300 hover:shadow-lg',
              'border-cyan-400 bg-gradient-to-r from-cyan-900/90 to-blue-900/90',
            )}
          >
            <div className="flex items-center mr-3">
              <button
                className="flex items-center justify-center p-1.5 rounded-full bg-cyan-700 hover:bg-cyan-600 transition-colors"
                onClick={() => {
                  repoStore.set({
                    ...repoStore.get(),
                    taskBranch: DEFAULT_TASK_BRANCH,
                  });
                }}
                disabled={isProcessing || isConfirming}
              >
                {isProcessing ? (
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                )}
              </button>
            </div>
            <div className="flex flex-col flex-grow overflow-hidden">
              <div
                className={classNames('flex items-center w-full', branch?.lastCommit?.message ? 'mb-1' : 'mt-[2px]')}
              >
                <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-cyan-600 rounded-full mr-2 flex-shrink-0">
                  Task
                </span>
                <h3 className="font-medium text-white truncate max-w-full">
                  {branch?.firstCommit?.title || 'New Task'}
                </h3>
              </div>
              {branch?.lastCommit?.message && (
                <p className="text-cyan-200 text-xs truncate opacity-80 w-full">
                  `Last commit: ${branch?.lastCommit.message.split('\n')[0]}`
                </p>
              )}
            </div>
            {mergeStatus && (
              <div className="flex items-center ml-3 flex-shrink-0 gap-1.5">
                {/* <button
                  className="px-4 py-1.5 bg-cyan-600 text-white rounded-md hover:bg-cyan-500 active:bg-cyan-700 transition-colors shadow-sm font-medium text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={async () => {
                    alert('WIP');
                  }}
                  disabled={isConfirming || isProcessing}
                >
                  Retry
                </button> */}
                {(mergeStatus === 'can_be_merged' && (
                  <button
                    className="px-4 py-1.5 bg-cyan-600 text-white rounded-md hover:bg-cyan-500 active:bg-cyan-700 transition-colors shadow-sm font-medium text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={async () => {
                      setIsConfirming(true);
                      setIsLoading(true);

                      try {
                        await mergeTaskBranch(repoStore.get().path, repoStore.get().taskBranch);
                        repoStore.set({
                          ...repoStore.get(),
                          taskBranch: DEFAULT_TASK_BRANCH,
                        });
                      } catch {
                        toast.error('Failed to merge task branch');
                      } finally {
                        setIsConfirming(false);
                        setIsLoading(false);
                      }
                    }}
                    disabled={isConfirming || isProcessing}
                  >
                    {isConfirming ? (
                      <span className="flex items-center">
                        <svg
                          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Confirming...
                      </span>
                    ) : (
                      'Confirm'
                    )}
                  </button>
                )) || (
                  <button
                    className="flex items-center justify-center px-4 py-1.5 bg-cyan-600 text-white rounded-md opacity-50 cursor-not-allowed transition-colors shadow-sm font-medium text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-50"
                    disabled={true}
                  >
                    {reloadCount < 2 ? 'Confirm' : mergeStatus}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-1 pb-4 -mt-4">
          <div className="relative z-1 pl-2 border-l border-cyan-400/70 ml-1 pt-4">
            <Messages {...otherProps} ref={ref} />
          </div>
        </div>
      </div>
    );
  },
);
