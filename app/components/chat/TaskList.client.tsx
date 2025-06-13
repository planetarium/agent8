import { useStore } from '@nanostores/react';
import { repoStore } from '~/lib/stores/repo';
import { toast } from 'react-toastify';

interface TaskListProps {
  taskBranches?: any[];
  reloadTaskBranches?: (projectPath: string) => void;
}

export function TaskList({ taskBranches = [], reloadTaskBranches: _reloadTaskBranches }: TaskListProps) {
  const repo = useStore(repoStore);

  // Filter only task branches (branches starting with 'task-')
  const tasks = taskBranches.filter(
    (branch) => branch.name && branch.name.startsWith('task-') && branch.name !== repo.taskBranch,
  );

  const handleTaskClick = (taskBranch: any) => {
    // Switch to Task
    repoStore.setKey('taskBranch', taskBranch.name);
    toast.success(`Switched to ${taskBranch.name}`);
  };

  const formatTaskName = (taskName: string) => {
    const timestamp = taskName.replace('task-', '');
    const date = new Date(parseInt(timestamp));

    return {
      taskNumber: `Task ${tasks.findIndex((t) => t.name === taskName) + 1}`,
      date: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  };

  return (
    <div
      className="flex flex-col h-full bg-bolt-elements-background-depth-2 border-l border-bolt-elements-borderColor"
      style={{ width: 'var(--workbench-width)' }}
    >
      <div className="flex-shrink-0 p-6 border-b border-bolt-elements-borderColor">
        <h2 className="text-xl font-semibold text-bolt-elements-textPrimary">🎯 Tasks</h2>
        <p className="text-base text-bolt-elements-textSecondary mt-2">
          {tasks.length > 0 ? `${tasks.length} tasks available` : 'No tasks'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tasks.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-6">📝</div>
            <h3 className="text-bolt-elements-textPrimary font-semibold text-lg mb-3">No Tasks</h3>
            <p className="text-bolt-elements-textSecondary text-base mb-3 max-w-md mx-auto">
              Tasks will be created automatically when you start a new conversation.
            </p>
            <p className="text-bolt-elements-textTertiary text-sm">
              💡 Each task provides an isolated work environment
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
            {tasks.map((task) => {
              const { taskNumber, date } = formatTaskName(task.name);
              return (
                <div
                  key={task.name}
                  onClick={() => handleTaskClick(task)}
                  className="group p-6 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-3 hover:border-bolt-elements-borderColorAccent cursor-pointer transition-all duration-200 transform hover:scale-[1.02] hover:shadow-lg"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <span className="text-base font-semibold text-bolt-elements-textPrimary">{taskNumber}</span>
                    </div>
                    <span className="text-sm text-bolt-elements-textTertiary">{date}</span>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm text-bolt-elements-textSecondary">
                      Branch:{' '}
                      <code className="px-2 py-1 bg-bolt-elements-background-depth-2 rounded text-sm font-mono">
                        {task.name}
                      </code>
                    </p>
                    <div className="flex items-center gap-3 text-sm text-bolt-elements-textTertiary">
                      <span>Click to open work environment</span>
                      <div className="i-ph:arrow-right group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
