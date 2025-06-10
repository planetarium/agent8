import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { repoStore } from '~/lib/stores/repo';
import { toast } from 'react-toastify';
import { getProjectIssues } from '~/lib/persistenceGitbase/api.client';
import type { GitlabIssue } from '~/lib/persistenceGitbase/types';

interface TaskListProps {
  reloadTaskBranches?: (projectPath: string) => void;
}

type TaskStatus = 'todo' | 'working' | 'completed' | 'canceled';

export function TaskList({ reloadTaskBranches: _reloadTaskBranches }: TaskListProps) {
  const repo = useStore(repoStore);
  const [issues, setIssues] = useState<GitlabIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIssues = useCallback(async () => {
    if (!repo.path) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await getProjectIssues(repo.path, 1, 50, 'opened');

      if (response.success) {
        setIssues(response.data.issues);
      } else {
        setError(response.message || 'Failed to load tasks');
      }
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [repo.path]);

  useEffect(() => {
    if (repo.path) {
      loadIssues();
    }
  }, [repo.path, loadIssues]);

  const handleIssueDetail = (issue: GitlabIssue) => {
    // Handle detail view - open issue URL
    if (issue.web_url) {
      window.open(issue.web_url, '_blank');
    }

    toast.success(`Task #${issue.iid} opened`);
  };

  const handleTaskAction = (issue: GitlabIssue, status: TaskStatus) => {
    // Handle task action based on status
    switch (status) {
      case 'todo':
        // TODO: Implement task execution logic
        toast.info(`Starting task #${issue.iid}...`);
        break;
      case 'working':
        // TODO: Implement task pause/resume logic
        toast.info(`Pausing task #${issue.iid}...`);
        break;
      case 'completed':
        // TODO: Implement task restart logic
        toast.info(`Restarting task #${issue.iid}...`);
        break;
      case 'canceled':
        // TODO: Implement task restart logic
        toast.info(`Restarting task #${issue.iid}...`);
        break;
      default:
        break;
    }
  };

  const getActionButtonIcon = (status: TaskStatus) => {
    switch (status) {
      case 'todo':
        return 'i-ph:play-fill';
      case 'working':
        return 'i-ph:pause-fill';
      case 'completed':
        return 'i-ph:arrow-clockwise';
      case 'canceled':
        return 'i-ph:arrow-clockwise';
      default:
        return 'i-ph:play-fill';
    }
  };

  const getActionButtonText = (status: TaskStatus) => {
    switch (status) {
      case 'todo':
        return 'Start';
      case 'working':
        return 'Pause';
      case 'completed':
        return 'Restart';
      case 'canceled':
        return 'Restart';
      default:
        return 'Start';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTaskStatus = (_issue: GitlabIssue): TaskStatus => {
    // TODO: Add branch and PR mapping conditions later
    return 'todo';
  };

  const renderStatusLabel = (status: TaskStatus) => {
    switch (status) {
      case 'todo':
        return (
          <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-[rgba(255,255,255,0.2)] rounded-full">
            Todo
          </span>
        );
      case 'working':
        return (
          <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-[rgba(63,210,232,0.5)] rounded-full">
            Working
          </span>
        );
      case 'completed':
        return (
          <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-green-600 rounded-full">
            Done
          </span>
        );
      case 'canceled':
        return (
          <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-red-600 rounded-full">
            Canceled
          </span>
        );
      default:
        return (
          <span className="inline-block px-2 py-0.5 text-xs font-semibold text-white bg-[rgba(255,255,255,0.2)] rounded-full">
            Task
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ width: 'var(--workbench-width)' }}>
      <div className="fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 left-[var(--workbench-left)] transition-[left,width] duration-200 bolt-ease-cubic-bezier">
        <div className="absolute inset-0 px-2 lg:px-6">
          <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
            <div className="flex-shrink-0 p-6 border-b border-bolt-elements-borderColor">
              <h2 className="font-medium text-white text-lg">🎯 Tasks</h2>
              <p className="text-[rgba(63,210,232,0.8)] text-xs mt-2">
                {loading ? 'Loading...' : error ? `Error: ${error}` : `${issues.length} tasks available`}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="text-center py-16">
                  <div className="text-6xl mb-6">⏳</div>
                  <h3 className="font-medium text-white text-lg mb-3">Loading</h3>
                  <p className="text-[rgba(63,210,232,0.8)] text-xs">Loading GitLab tasks...</p>
                </div>
              ) : error ? (
                <div className="text-center py-16">
                  <div className="text-6xl mb-6">❌</div>
                  <h3 className="font-medium text-white text-lg mb-3">Error Occurred</h3>
                  <p className="text-[rgba(63,210,232,0.8)] text-xs mb-3 max-w-md mx-auto">{error}</p>
                  <button
                    onClick={loadIssues}
                    className="px-4 py-1.5 bg-transparent text-[rgba(63,210,232,0.9)] rounded-md hover:bg-[rgba(63,210,232,0.15)] transition-colors shadow-sm font-medium text-sm"
                  >
                    Try Again
                  </button>
                </div>
              ) : issues.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-6xl mb-6">📝</div>
                  <h3 className="font-medium text-white text-lg mb-3">No Tasks</h3>
                  <p className="text-[rgba(63,210,232,0.8)] text-xs mb-3 max-w-md mx-auto">
                    There are no open tasks in the current project.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {issues.map((issue) => {
                    const taskStatus = getTaskStatus(issue);

                    return (
                      <div
                        key={issue.id}
                        className="flex w-full mb-2 rounded-lg border border-[#3FD2E8] bg-[var(--color-bg-primary,#111315)] p-4 transition-all hover:border-[#3FD2E8] hover:shadow-lg"
                      >
                        <div className="flex flex-col flex-grow overflow-hidden">
                          <div className="flex items-center mb-1 w-full">
                            <div className="flex-shrink-0 mr-2">{renderStatusLabel(taskStatus)}</div>
                            <h3 className="font-medium text-white truncate max-w-full flex-1">
                              <span
                                className="cursor-pointer hover:text-[rgba(63,210,232,0.9)] transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleIssueDetail(issue);
                                }}
                              >
                                {issue.title}
                              </span>
                            </h3>
                          </div>

                          <p className="text-[rgba(63,210,232,0.8)] text-xs truncate opacity-80 w-full">
                            Created: {formatDate(issue.created_at)} • Updated: {formatDate(issue.updated_at)}
                          </p>
                        </div>

                        <div className="flex items-center ml-3 flex-shrink-0 gap-1.5">
                          <button
                            className="p-1.5 bg-[rgba(63,210,232,0.8)] text-white rounded-md hover:bg-[rgba(63,210,232,0.9)] active:bg-[rgba(63,210,232,1)] transition-colors focus:outline-none focus:ring-2 focus:ring-[rgba(63,210,232,0.5)] focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTaskAction(issue, taskStatus);
                            }}
                            title={getActionButtonText(taskStatus)}
                          >
                            <div className={`${getActionButtonIcon(taskStatus)} text-sm`} />
                          </button>
                          <button
                            className="p-1.5 bg-transparent text-[rgba(63,210,232,0.9)] rounded-md hover:bg-[rgba(63,210,232,0.15)] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIssueDetail(issue);
                            }}
                            title="View Details"
                          >
                            <div className="i-ph:arrow-right text-sm" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
