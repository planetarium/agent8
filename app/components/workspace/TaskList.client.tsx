import { useStore } from '@nanostores/react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { repoStore } from '~/lib/stores/repo';
import { getProjectIssues, updateIssueLabels } from '~/lib/persistenceGitbase/api.client';
import type { GitlabIssue } from '~/lib/persistenceGitbase/types';

// Export GitlabIssue type for use in other components
export type { GitlabIssue } from '~/lib/persistenceGitbase/types';
import { TaskDetail } from './TaskDetail.client';

interface TaskListProps {
  // Remove taskBranches props as we'll fetch issues directly
  selectedTaskId?: string;
  onTaskSelect?: (issue: GitlabIssue | null) => void;
}

type FilterType = 'All' | 'TODO' | 'WIP' | 'CONFIRM NEEDED' | 'DONE' | 'REJECT';

const FILTER_LABELS: Record<FilterType, string | undefined> = {
  All: undefined,
  TODO: 'TODO',
  WIP: 'WIP',
  'CONFIRM NEEDED': 'CONFIRM NEEDED',
  DONE: 'DONE',
  REJECT: 'REJECT',
};

export function TaskList({ selectedTaskId, onTaskSelect }: TaskListProps) {
  const repo = useStore(repoStore);
  const [issues, setIssues] = useState<GitlabIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<GitlabIssue | null>(null);
  const [updatingIssues, setUpdatingIssues] = useState<Set<number>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fetchIssues = async (filter: FilterType = 'All', page: number = 1, appendToExisting: boolean = false) => {
    if (!repo.path) {
      return;
    }

    if (page === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    setError(null);

    try {
      const result = await getProjectIssues(repo.path, {
        state: 'opened',
        perPage: 20,
        page,
        additionalLabel: FILTER_LABELS[filter],
      });

      if (result.success) {
        if (appendToExisting && page > 1) {
          setIssues((prev) => [...prev, ...result.data.issues]);
        } else {
          setIssues(result.data.issues);
        }

        setHasMore(result.data.pagination.hasMore);
      } else {
        setError(result.message || 'Failed to fetch issues');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Error fetching issues:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Load more data when scrolling
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchIssues(activeFilter, nextPage, true);
    }
  }, [activeFilter, currentPage, loadingMore, hasMore]);

  // Check if container has scroll and auto-load if needed
  const checkAndLoadIfNeeded = useCallback(() => {
    if (!scrollContainerRef.current || loadingMore || !hasMore) {
      return;
    }

    const { scrollHeight, clientHeight } = scrollContainerRef.current;
    const hasScroll = scrollHeight > clientHeight;

    // If there's no scroll (content doesn't fill the container), load more
    if (!hasScroll) {
      loadMore();
    }
  }, [loadMore, loadingMore, hasMore]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100; // 100px threshold

    if (isNearBottom && !loadingMore && hasMore) {
      loadMore();
    }
  }, [loadMore, loadingMore, hasMore]);

  // Set up scroll listener
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return undefined;
    }

    scrollContainer.addEventListener('scroll', handleScroll);

    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Check if we need to load more after issues change
  useEffect(() => {
    if (!loading && issues.length > 0) {
      // Use setTimeout to ensure DOM is updated
      const timer = setTimeout(checkAndLoadIfNeeded, 100);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [issues, loading, checkAndLoadIfNeeded]);

  // Reset and fetch when repo or filter changes
  useEffect(() => {
    setCurrentPage(1);
    setHasMore(true);
    fetchIssues(activeFilter, 1, false);
  }, [repo.path, activeFilter]);

  const handleFilterChange = (filter: FilterType) => {
    setActiveFilter(filter);
  };

  const handleIssueClick = (issue: GitlabIssue) => {
    // Check if issue is clickable (has labels other than agentic and not TODO)
    if (!isIssueClickable(issue)) {
      return;
    }

    // Notify parent component about task selection
    onTaskSelect?.(issue);

    // Show task detail instead of opening external link
    setSelectedIssue(issue);
  };

  const isIssueClickable = (_issue: GitlabIssue) => {
    // All issues are now clickable for detail view
    return true;
  };

  const handleBackToList = () => {
    setSelectedIssue(null);

    // Clear selection when going back to list
    onTaskSelect?.(null);
  };

  const handleAddTodoLabel = async (issue: GitlabIssue) => {
    if (!repo.path) {
      return;
    }

    // Prevent multiple simultaneous updates
    if (updatingIssues.has(issue.id)) {
      return;
    }

    setUpdatingIssues((prev) => new Set(prev).add(issue.id));

    try {
      // Get current labels and add TODO (keep agentic)
      const currentLabels = issue.labels || [];
      const newLabels = [...currentLabels, 'TODO'];

      const response = await updateIssueLabels(repo.path, issue.iid, newLabels);

      if (response.success) {
        // Update the issue in the local state
        setIssues((prevIssues) =>
          prevIssues.map((prevIssue) => (prevIssue.id === issue.id ? { ...prevIssue, labels: newLabels } : prevIssue)),
        );

        toast.success('Task started successfully');
      } else {
        throw new Error(response.message || 'Failed to add TODO label');
      }
    } catch (error) {
      console.error('Error adding TODO label:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to start task: ${errorMessage}`);
    } finally {
      setUpdatingIssues((prev) => {
        const newSet = new Set(prev);
        newSet.delete(issue.id);

        return newSet;
      });
    }
  };

  const handleRestartTask = async (issue: GitlabIssue) => {
    if (!repo.path) {
      return;
    }

    // Prevent multiple simultaneous updates
    if (updatingIssues.has(issue.id)) {
      return;
    }

    setUpdatingIssues((prev) => new Set(prev).add(issue.id));

    try {
      // Get current labels, remove REJECT and add TODO
      const currentLabels = issue.labels || [];
      const newLabels = currentLabels.filter((label) => label !== 'REJECT').concat('TODO');

      const response = await updateIssueLabels(repo.path, issue.iid, newLabels);

      if (response.success) {
        // Update the issue in the local state
        setIssues((prevIssues) =>
          prevIssues.map((prevIssue) => (prevIssue.id === issue.id ? { ...prevIssue, labels: newLabels } : prevIssue)),
        );

        toast.success('Task restarted successfully');
      } else {
        throw new Error(response.message || 'Failed to restart task');
      }
    } catch (error) {
      console.error('Error restarting task:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to restart task: ${errorMessage}`);
    } finally {
      setUpdatingIssues((prev) => {
        const newSet = new Set(prev);
        newSet.delete(issue.id);

        return newSet;
      });
    }
  };

  const isIssueWithoutLabels = (issue: GitlabIssue) => {
    const filteredLabels = issue.labels?.filter((label) => label !== 'agentic') || [];

    return filteredLabels.length === 0;
  };

  const isIssueRejected = (issue: GitlabIssue) => {
    const filteredLabels = issue.labels?.filter((label) => label !== 'agentic') || [];

    return filteredLabels.includes('REJECT');
  };

  const getLabelColor = (label: string) => {
    // Define specific colors for common label types
    const labelColors: Record<string, string> = {
      TODO: '#6B7280', // Gray - not started
      WIP: '#10B981', // Green - in progress
      'CONFIRM NEEDED': '#3B82F6', // Blue - needs confirmation
      DONE: '#6B7280', // Gray - completed
      REJECT: '#EF4444', // Red - rejected/cancelled
    };

    // Return predefined color if exists, otherwise use a muted default
    return labelColors[label] || '#8B5CF6'; // Purple for other labels
  };

  const getStatusColor = (issue: GitlabIssue) => {
    const filteredLabels = issue.labels?.filter((label) => label !== 'agentic') || [];

    // No labels or TODO: Gray
    if (filteredLabels.length === 0 || filteredLabels.includes('TODO')) {
      return 'bg-gray-500';
    }

    // WIP: Green
    if (filteredLabels.includes('WIP')) {
      return 'bg-green-500';
    }

    // CONFIRM NEEDED: Blue
    if (filteredLabels.includes('CONFIRM NEEDED')) {
      return 'bg-blue-500';
    }

    // REJECT: Red
    if (filteredLabels.includes('REJECT')) {
      return 'bg-red-500';
    }

    // DONE: Gray
    if (filteredLabels.includes('DONE')) {
      return 'bg-gray-500';
    }

    // Default: Green
    return 'bg-green-500';
  };

  return (
    <div className="relative h-full overflow-hidden">
      {/* Task List View */}
      <motion.div
        className="absolute inset-0 flex flex-col"
        initial={{ x: 0 }}
        animate={{ x: selectedIssue ? '-100%' : 0 }}
        transition={{ type: 'tween', duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-3">
          <div className="flex items-center justify-between">
            {/* Filter buttons */}
            <div className="flex flex-wrap gap-2">
              {Object.keys(FILTER_LABELS).map((filter) => (
                <button
                  key={filter}
                  onClick={() => handleFilterChange(filter as FilterType)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                    activeFilter === filter
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Issues count - right aligned */}
            <p className="text-base text-bolt-elements-textSecondary">
              {loading
                ? 'Loading...'
                : `${issues.length} ${activeFilter === 'All' ? '' : activeFilter.toLowerCase()} issues available`}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="relative flex-1 overflow-hidden">
          {/* Task List View */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 pb-6">
            {error ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-6">⚠️</div>
                <h3 className="text-bolt-elements-textPrimary font-semibold text-lg mb-3">Error</h3>
                <p className="text-bolt-elements-textSecondary text-base mb-3 max-w-md mx-auto">{error}</p>
                <button
                  onClick={() => {
                    setCurrentPage(1);
                    setHasMore(true);
                    fetchIssues(activeFilter, 1, false);
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : loading ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-6">⏳</div>
                <h3 className="text-bolt-elements-textPrimary font-semibold text-lg mb-3">Loading Issues</h3>
                <p className="text-bolt-elements-textSecondary text-base">Fetching issues from GitLab...</p>
              </div>
            ) : issues.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-6">📝</div>
                <h3 className="text-bolt-elements-textPrimary font-semibold text-lg mb-3">
                  No {activeFilter === 'All' ? 'Agentic' : activeFilter} Issues
                </h3>
                <p className="text-bolt-elements-textSecondary text-base mb-3 max-w-md mx-auto">
                  {activeFilter === 'All'
                    ? "There are no open issues with 'agentic' label in this project."
                    : `There are no open issues with 'agentic' and '${activeFilter}' labels in this project.`}
                </p>
                <p className="text-bolt-elements-textTertiary text-sm">
                  💡 Create issues with appropriate labels in GitLab to see them here
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {issues.map((issue) => {
                    const clickable = isIssueClickable(issue);
                    const hasNoLabels = isIssueWithoutLabels(issue);
                    const isRejected = isIssueRejected(issue);
                    const isUpdating = updatingIssues.has(issue.id);

                    return (
                      <div
                        key={issue.id}
                        onClick={() => clickable && handleIssueClick(issue)}
                        className={`group p-4 rounded-lg border transition-all duration-200 ${
                          selectedTaskId === issue.id.toString()
                            ? 'border-bolt-elements-item-borderAccent bg-bolt-elements-item-backgroundAccent'
                            : clickable
                              ? 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-3 hover:border-bolt-elements-borderColorAccent cursor-pointer hover:shadow-sm'
                              : 'border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-1/50'
                        } ${hasNoLabels && !clickable ? 'opacity-60' : clickable ? '' : 'opacity-60'}`}
                      >
                        <div className="flex items-center gap-4">
                          {/* Status indicator and issue number */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(issue)}`}></div>
                            <span className="text-sm font-semibold text-bolt-elements-textPrimary">#{issue.iid}</span>
                          </div>

                          {/* Issue title */}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium text-bolt-elements-textPrimary truncate">
                              {issue.title}
                            </h3>
                          </div>

                          {/* Labels and Action buttons */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Show labels if they exist */}
                            {issue.labels && issue.labels.filter((label) => label !== 'agentic').length > 0 && (
                              <div className="flex gap-2">
                                {issue.labels
                                  .filter((label) => label !== 'agentic')
                                  .slice(0, 2)
                                  .map((label) => (
                                    <span
                                      key={label}
                                      className="px-2 py-0.5 text-xs rounded-full text-white font-medium"
                                      style={{ backgroundColor: getLabelColor(label) }}
                                    >
                                      {label}
                                    </span>
                                  ))}
                                {issue.labels.filter((label) => label !== 'agentic').length > 2 && (
                                  <span className="px-2 py-0.5 text-xs rounded-full bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary">
                                    +{issue.labels.filter((label) => label !== 'agentic').length - 2}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Action buttons */}
                            {hasNoLabels ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddTodoLabel(issue);
                                }}
                                disabled={isUpdating}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 transition-colors shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isUpdating ? (
                                  <>
                                    <div className="i-ph:spinner-gap animate-spin w-3 h-3" />
                                    <span>Starting...</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="i-ph:play w-3 h-3" />
                                    <span>Start Task</span>
                                  </>
                                )}
                              </button>
                            ) : isRejected ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestartTask(issue);
                                }}
                                disabled={isUpdating}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700 transition-colors shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isUpdating ? (
                                  <>
                                    <div className="i-ph:spinner-gap animate-spin w-3 h-3" />
                                    <span>Restarting...</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="i-ph:arrow-clockwise w-3 h-3" />
                                    <span>Restart</span>
                                  </>
                                )}
                              </button>
                            ) : null}
                          </div>

                          {/* External link icon or disabled indicator */}
                          <div
                            className={`flex-shrink-0 transition-colors ${
                              clickable
                                ? 'text-bolt-elements-textTertiary group-hover:text-bolt-elements-textPrimary'
                                : 'text-bolt-elements-textTertiary/50'
                            }`}
                          >
                            <div className={`w-4 h-4 ${clickable ? 'i-ph:arrow-square-out' : 'i-ph:lock'}`} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Loading more indicator */}
                {loadingMore && (
                  <div className="text-center py-8">
                    <div className="text-2xl mb-2">⏳</div>
                    <p className="text-sm text-bolt-elements-textSecondary">Loading more issues...</p>
                  </div>
                )}

                {/* End of list indicator */}
                {!hasMore && issues.length > 0 && (
                  <div className="text-center py-8">
                    <p className="text-sm text-bolt-elements-textTertiary">No more issues to load</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Task Detail View */}
      <motion.div
        className="absolute inset-0 flex flex-col"
        initial={{ x: '100%' }}
        animate={{ x: selectedIssue ? 0 : '100%' }}
        transition={{ type: 'tween', duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {selectedIssue && <TaskDetail issue={selectedIssue} onBack={handleBackToList} />}
      </motion.div>
    </div>
  );
}
