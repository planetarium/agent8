import { useStore } from '@nanostores/react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { repoStore } from '~/lib/stores/repo';
import { getProjectIssues } from '~/lib/persistenceGitbase/api.client';
import type { GitlabIssue } from '~/lib/persistenceGitbase/types';

interface TaskListProps {
  // Remove taskBranches props as we'll fetch issues directly
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

export function TaskList({}: TaskListProps) {
  const repo = useStore(repoStore);
  const [issues, setIssues] = useState<GitlabIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
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
        perPage: 10,
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
    // Open issue in new tab
    window.open(issue.web_url, '_blank');
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
    const filteredLabels = issue.labels?.filter((label) => label !== 'auto-container') || [];

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
    <div className="fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 left-[var(--workbench-left)] transition-[left,width] duration-200">
      <div className="absolute inset-0 px-2 lg:px-6">
        <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
          <div className="flex-shrink-0 p-6 border-b border-bolt-elements-borderColor">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-bolt-elements-textPrimary">🎯 Tasks</h2>
            </div>

            {/* Filter buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
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

            <p className="text-base text-bolt-elements-textSecondary">
              {loading
                ? 'Loading...'
                : `${issues.length} ${activeFilter === 'All' ? '' : activeFilter.toLowerCase()} issues available`}
            </p>
          </div>
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
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
                  No {activeFilter === 'All' ? 'Auto-Container' : activeFilter} Issues
                </h3>
                <p className="text-bolt-elements-textSecondary text-base mb-3 max-w-md mx-auto">
                  {activeFilter === 'All'
                    ? "There are no open issues with 'auto-container' label in this project."
                    : `There are no open issues with 'auto-container' and '${activeFilter}' labels in this project.`}
                </p>
                <p className="text-bolt-elements-textTertiary text-sm">
                  💡 Create issues with appropriate labels in GitLab to see them here
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {issues.map((issue) => (
                    <div
                      key={issue.id}
                      onClick={() => handleIssueClick(issue)}
                      className="group p-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-3 hover:border-bolt-elements-borderColorAccent cursor-pointer transition-all duration-200 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-4">
                        {/* Status indicator and issue number */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(issue)}`}></div>
                          <span className="text-sm font-semibold text-bolt-elements-textPrimary">#{issue.iid}</span>
                        </div>

                        {/* Issue title */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-bolt-elements-textPrimary truncate">{issue.title}</h3>
                        </div>

                        {/* Labels */}
                        {issue.labels && issue.labels.filter((label) => label !== 'auto-container').length > 0 && (
                          <div className="flex gap-2 flex-shrink-0">
                            {issue.labels
                              .filter((label) => label !== 'auto-container')
                              .slice(0, 2)
                              .map((label) => (
                                <span
                                  key={label}
                                  className="px-2 py-1 text-xs rounded-full text-white font-medium"
                                  style={{ backgroundColor: getLabelColor(label) }}
                                >
                                  {label}
                                </span>
                              ))}
                            {issue.labels.filter((label) => label !== 'auto-container').length > 2 && (
                              <span className="px-2 py-1 text-xs rounded-full bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary">
                                +{issue.labels.filter((label) => label !== 'auto-container').length - 2}
                              </span>
                            )}
                          </div>
                        )}

                        {/* External link icon */}
                        <div className="flex-shrink-0 text-bolt-elements-textTertiary group-hover:text-bolt-elements-textPrimary transition-colors">
                          <div className="i-ph:arrow-square-out w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  ))}
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
      </div>
    </div>
  );
}
