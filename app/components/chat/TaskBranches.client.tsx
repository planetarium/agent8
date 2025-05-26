import { forwardRef, useState } from 'react';
import { toast } from 'react-toastify';
import { removeTaskBranch } from '~/lib/persistenceGitbase/api.client';
import { repoStore } from '~/lib/stores/repo';

interface TaskBranchesProps {
  taskBranches?: any[];
  currentTaskBranch?: any;
  reloadTaskBranches?: (projectPath: string) => void;
}

const TaskBranch = ({ branch, onRemove }: { branch: any; onRemove: () => Promise<void> }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleClose = async () => {
    try {
      setIsLoading(true);
      await removeTaskBranch(repoStore.get().path, branch.name);
      await onRemove();
    } catch {
      toast.error('Failed to close branch');
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = async () => {
    repoStore.set({
      ...repoStore.get(),
      taskBranch: branch.name,
    });
  };

  return (
    <div className="flex w-full flex-1 max-w-chat mx-auto max-h-22 mb-6 rounded-lg border border-[#3FD2E8] bg-[var(--color-bg-primary,#111315)] p-4 transition-all hover:border-[#3FD2E8] hover:shadow-lg">
      <div className="flex flex-col flex-grow overflow-hidden">
        <div className="flex items-center mb-1 w-full">
          <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-[rgba(63,210,232,0.5)] rounded-full mr-2 flex-shrink-0">
            Task
          </span>
          <h3 className="font-medium text-white truncate max-w-full">{branch?.firstCommit?.title || 'New Task'}</h3>
        </div>
        <p className="text-[rgba(63,210,232,0.8)] text-xs truncate opacity-80 w-full">
          {branch?.lastCommit?.message ? `Last commit: ${branch?.lastCommit.message.split('\n')[0]}` : ''}
        </p>
      </div>
      <div className="flex items-center ml-3 flex-shrink-0 gap-1.5">
        <button
          className="px-4 py-1.5 bg-transparent text-[rgba(63,210,232,0.9)] rounded-md hover:bg-[rgba(63,210,232,0.15)] transition-colors shadow-sm font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleClose}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center">
              <svg
                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Closing...
            </span>
          ) : (
            'Close'
          )}
        </button>
        <button
          className="px-4 py-1.5 bg-[rgba(63,210,232,0.8)] text-white rounded-md hover:bg-[rgba(63,210,232,0.9)] active:bg-[rgba(63,210,232,1)] transition-colors shadow-sm font-medium text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(63,210,232,0.5)] focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleContinue}
          disabled={isLoading}
        >
          Continue
        </button>
      </div>
    </div>
  );
};

export const TaskBranches = forwardRef<HTMLDivElement, TaskBranchesProps>((props: TaskBranchesProps) => {
  const taskBranches = props.taskBranches;
  return taskBranches?.map((branch) => (
    <TaskBranch
      key={branch.name}
      branch={branch}
      onRemove={async () => {
        if (props.reloadTaskBranches) {
          await props.reloadTaskBranches(repoStore.get().path);
        }
      }}
    />
  ));
});
