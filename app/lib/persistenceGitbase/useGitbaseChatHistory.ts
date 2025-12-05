import { useState, useEffect, useCallback, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { FileMap } from '~/lib/stores/files';
import { repoStore } from '~/lib/stores/repo';
import {
  getProjectCommits,
  fetchProjectFiles,
  getTaskBranches,
  revertBranch,
  getRestorePoint,
  getRestoreHistory,
} from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { createScopedLogger } from '~/utils/logger';
import { lastActionStore } from '~/lib/stores/lastAction';
import type { RestoreHistoryEntry } from '~/lib/persistenceGitbase/gitlabService';
import { restoreEventStore, clearRestoreEvent } from '~/lib/stores/restore';

const logger = createScopedLogger('useGitbaseChatHistory');

interface Commit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  created_at: string;
  committed_date: string;
}

interface PaginationInfo {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  totalPages: number;
}

interface CommitResponse {
  success: boolean;
  data: {
    project: {
      id: string;
      name: string;
      description: string;
    };
    commits: Commit[];
    pagination: PaginationInfo;
  };
  error?: string;
}

export function useGitbaseChatHistory() {
  const projectPath = repoStore.get().path;
  const [project, setProject] = useState<{
    id: string;
    name: string;
    description: string;
  }>({
    id: '',
    name: '',
    description: '',
  });
  const [chats, setChats] = useState<UIMessage[]>([]);
  const [enabledTaskMode, setEnabledTaskMode] = useState(true);
  const [files, setFiles] = useState<FileMap>({});
  const [taskBranches, setTaskBranches] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingBefore, setLoadingBefore] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [cachedRestoreHistory, setCachedRestoreHistory] = useState<RestoreHistoryEntry[]>([]);
  const prevRequestParams = useRef<{ [key: string]: any }>({});

  const loadTaskBranches = useCallback(async (projectPath: string) => {
    const { data } = await getTaskBranches(projectPath);
    setTaskBranches(data);
  }, []);

  const loadFiles = useCallback(
    async (projectPath: string, commitSha?: string) => {
      if (!projectPath) {
        return;
      }

      try {
        setFilesLoaded(false);

        setLoadingFiles(true);

        const fileMap = await fetchProjectFiles(projectPath, commitSha);

        setFiles(fileMap);
        setFilesLoaded(true);
      } catch (fileError) {
        logger.error('Error fetching project files:', fileError);
      } finally {
        setLoadingFiles(false);
      }
    },
    [fetchProjectFiles],
  );

  const load = useCallback(
    async ({
      page = 1,
      taskBranch,
      untilCommit,
      fileCommit,
      force,
    }: {
      page?: number;
      taskBranch?: string;
      untilCommit?: string;
      fileCommit?: string;
      force?: boolean;
    }) => {
      if (!projectPath) {
        setLoaded(true);
        setFilesLoaded(true);
        setChats([]);
        setFiles({});

        return;
      }

      logger.debug(`loaded, page: ${page}, taskBranch: ${taskBranch}, untilCommit: ${untilCommit}`);

      if (!force) {
        // 이미 로딩 중이면 종료
        if (loading) {
          return;
        }

        if (
          projectPath === prevRequestParams.current.projectPath &&
          page === prevRequestParams.current.page &&
          taskBranch === prevRequestParams.current.taskBranch &&
          untilCommit === prevRequestParams.current.untilCommit
        ) {
          return;
        }
      }

      if (page === 1) {
        setLoaded(false);
        setLoading(true);
        setError(null);
      } else {
        setLoadingBefore(true);
      }

      try {
        const queryParams = new URLSearchParams({
          projectPath,
          page: page.toString(),
        });

        if (taskBranch) {
          queryParams.append('branch', taskBranch);
        }

        if (untilCommit) {
          queryParams.append('untilCommit', untilCommit);
        }

        prevRequestParams.current = {
          projectPath,
          page,
          taskBranch,
          untilCommit,
        };

        if (page === 1) {
          if (Object.keys(files).length > 0) {
            lastActionStore.set({ action: 'LOAD' });
          }

          await Promise.all([
            loadFiles(projectPath, fileCommit || untilCommit || taskBranch || undefined),
            loadTaskBranches(projectPath),
          ]);
        }

        const data = (await getProjectCommits(projectPath, {
          branch: taskBranch,
          untilCommit,
          page,
          all: true, // Get all commits including unreachable ones
        })) as CommitResponse;

        if (!data.success) {
          const error = new Error(data.error || 'Failed to fetch commit history');

          // Check if it's a 404 error (project not found or access denied)
          if (data.error?.includes('Project not found')) {
            (error as any).status = 404;
          }

          throw error;
        }

        setProject(data.data.project);

        const newMessages = parseCommitMessages(data.data.commits);

        // Get restore history and filter by commit time range
        let restoreMessages: UIMessage[] = [];

        try {
          // Fetch restore history only on first page load, then use cache
          let restoreHistory = cachedRestoreHistory;

          if (page === 1) {
            restoreHistory = await getRestoreHistory(projectPath);
            setCachedRestoreHistory(restoreHistory);
          }

          // Calculate time range of loaded messages
          if (newMessages.length > 0) {
            const messageTimes = newMessages
              .map((msg) => {
                const metadata = msg.metadata as any;
                return metadata?.createdAt ? new Date(metadata.createdAt).getTime() : 0;
              })
              .filter((time) => time > 0);

            if (messageTimes.length > 0) {
              const minTime = Math.min(...messageTimes);

              // Filter restore messages: include all restores from the earliest commit onwards
              const filteredHistory = restoreHistory.filter((entry: RestoreHistoryEntry) => {
                const restoreTime = new Date(entry.restoredAt).getTime();
                return restoreTime >= minTime; // Include all restores from minTime onwards
              });

              restoreMessages = filteredHistory.map((entry: RestoreHistoryEntry) => ({
                id: `restore-${entry.commitHash}`,
                role: 'assistant' as const,
                parts: [
                  {
                    type: 'text' as const,
                    text: `${entry.commitTitle}`,
                  },
                ],
                metadata: {
                  createdAt: new Date(entry.restoredAt),
                  annotations: ['restore-message'],
                },
              }));
            }
          }
        } catch (err) {
          logger.warn('Failed to load restore history:', err);
        }

        if (page > 1) {
          // Load More: Merge new messages with restore messages and existing chats, then sort
          setChats((prevChats) => {
            const allMessages = [...newMessages, ...restoreMessages, ...prevChats];

            allMessages.sort((a, b) => {
              const metadataA = a.metadata as any;
              const metadataB = b.metadata as any;
              const timeA = metadataA?.createdAt ? new Date(metadataA.createdAt).getTime() : 0;
              const timeB = metadataB?.createdAt ? new Date(metadataB.createdAt).getTime() : 0;

              // Sort by timestamp first
              if (timeA !== timeB) {
                return timeA - timeB;
              }

              // If same timestamp, user messages come before assistant messages
              if (a.role === 'user' && b.role === 'assistant') {
                return -1;
              }

              if (a.role === 'assistant' && b.role === 'user') {
                return 1;
              }

              return 0;
            });

            return allMessages;
          });
        } else {
          // First load: Combine restore messages with regular messages and sort by timestamp
          const allMessages = [...newMessages, ...restoreMessages];
          allMessages.sort((a, b) => {
            const metadataA = a.metadata as any;
            const metadataB = b.metadata as any;
            const timeA = metadataA?.createdAt ? new Date(metadataA.createdAt).getTime() : 0;
            const timeB = metadataB?.createdAt ? new Date(metadataB.createdAt).getTime() : 0;

            // Sort by timestamp first
            if (timeA !== timeB) {
              return timeA - timeB;
            }

            // If same timestamp, user messages come before assistant messages
            if (a.role === 'user' && b.role === 'assistant') {
              return -1;
            }

            if (a.role === 'assistant' && b.role === 'user') {
              return 1;
            }

            return 0;
          });
          setChats(allMessages);
        }

        setLoaded(true);
        setCurrentPage(page);
        setHasMore(data.data.pagination.hasMore);
      } catch (err) {
        // Handle axios errors specifically
        if (err && typeof err === 'object' && 'response' in err) {
          const axiosError = err as any;

          if (axiosError.response?.status === 404) {
            setError({
              message: axiosError.response?.data?.message || 'Project not found',
              status: 404,
            });
          } else if (axiosError.response?.status === 401) {
            setError({
              message: axiosError.response?.data?.message || 'Unauthorized',
              status: 401,
            });
          } else {
            setError({
              message:
                axiosError.response?.data?.message || axiosError.message || 'Unknown error fetching commit history',
            });
          }
        } else {
          setError({
            message: err instanceof Error ? err.message : 'Unknown error fetching commit history',
          });
        }

        logger.error('Error fetching commit history:', err);
      } finally {
        setLoaded(true);
        setLoading(false);
        setLoadingBefore(false);
      }
    },
    [projectPath, loading, fetchProjectFiles],
  );

  // Load more commits
  const loadBefore = useCallback(async () => {
    if (loadingBefore || !hasMore) {
      return;
    }

    await load({
      page: currentPage + 1,
      taskBranch: prevRequestParams.current.taskBranch,
      untilCommit: prevRequestParams.current.untilCommit,
    });
  }, [loading, hasMore, currentPage, load]);

  useEffect(() => {
    const initializeLoad = async () => {
      // Read revertTo from URL query parameters (priority 1)
      const url = new URL(window.location.href);
      const revertToParam = url.searchParams.get('revertTo');
      let revertToCommit = revertToParam && isCommitHash(revertToParam) ? revertToParam : undefined;

      // If no URL parameter, try to get from GitLab (priority 2)
      if (!revertToCommit && projectPath) {
        try {
          const savedRestorePoint = await getRestorePoint(projectPath);

          if (savedRestorePoint && isCommitHash(savedRestorePoint)) {
            revertToCommit = savedRestorePoint;
          }
        } catch (err) {
          console.warn('Failed to get restore point from GitLab:', err);
        }
      }

      // Initial load on mount or projectPath change
      if (
        projectPath &&
        (projectPath !== prevRequestParams.current.projectPath ||
          repoStore.get().taskBranch !== prevRequestParams.current.taskBranch)
      ) {
        // Always load all chat history (don't filter by untilCommit)
        load({ page: 1, taskBranch: repoStore.get().taskBranch, fileCommit: revertToCommit, untilCommit: undefined });
      }
    };

    initializeLoad();

    const unsubscribe = repoStore.subscribe(async (state) => {
      if (
        projectPath !== prevRequestParams.current.projectPath ||
        state.taskBranch !== prevRequestParams.current.taskBranch
      ) {
        // Read revertTo from URL or GitLab
        const url = new URL(window.location.href);
        const revertToParam = url.searchParams.get('revertTo');
        let revertToCommit = revertToParam && isCommitHash(revertToParam) ? revertToParam : undefined;

        if (!revertToCommit && projectPath) {
          try {
            const savedRestorePoint = await getRestorePoint(projectPath);

            if (savedRestorePoint && isCommitHash(savedRestorePoint)) {
              revertToCommit = savedRestorePoint;
            }
          } catch (err) {
            console.warn('Failed to get restore point from GitLab:', err);
          }
        }

        load({ page: 1, taskBranch: state.taskBranch, fileCommit: revertToCommit, untilCommit: undefined });
      }
    });

    return () => unsubscribe();
  }, [load, projectPath]);

  // Subscribe to restore events and add message to chat
  useEffect(() => {
    const unsubscribe = restoreEventStore.subscribe((event) => {
      if (event && loaded) {
        const restoreMessage: UIMessage = {
          id: `restore-${event.commitHash}-${event.timestamp}`,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `${event.commitTitle}`,
            },
          ],
          metadata: {
            createdAt: new Date(),
            annotations: ['restore-message'],
          },
        };

        // Add restore message to the end of chats (most recent)
        setChats((prevChats) => [...prevChats, restoreMessage]);

        // Update cached restore history with new entry
        const newEntry: RestoreHistoryEntry = {
          commitHash: event.commitHash,
          commitTitle: event.commitTitle,
          restoredAt: new Date().toISOString(),
        };

        setCachedRestoreHistory((prevHistory) => [newEntry, ...prevHistory].slice(0, 200));

        // Clear the event after processing
        clearRestoreEvent();
      }
    });

    return () => unsubscribe();
  }, [loaded]);

  return {
    loaded: loaded && filesLoaded,
    chats,
    revertTo: async (hash: string) => {
      setLoading(true);

      try {
        await revertBranch(projectPath, repoStore.get().taskBranch, hash);
        await load({ page: 1, taskBranch: repoStore.get().taskBranch, untilCommit: hash, force: true });
      } finally {
        setLoading(false);
      }
    },
    project,
    files,
    taskBranches,
    reloadTaskBranches: loadTaskBranches,
    enabledTaskMode,
    setEnabledTaskMode,
    loading: loading || loadingFiles,
    loadingBefore,
    error,
    hasMore,
    loadBefore,
  };
}

const parseCommitMessages = (commits: Commit[]): UIMessage[] => {
  const messages: UIMessage[] = [];

  commits.forEach((commit) => {
    // Use regex to extract assistant message
    const assistantMessageMatch = commit.message.match(/<V8AssistantMessage>([\s\S]*?)<\/V8AssistantMessage>/);
    const assistantMatched = assistantMessageMatch && assistantMessageMatch[1];

    if (assistantMatched) {
      const assistantContent = assistantMessageMatch[1].trim();

      if (assistantContent) {
        messages.push({
          id: `${commit.id}`,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: assistantContent,
            },
          ],
          metadata: {
            createdAt: new Date(commit.created_at),
          },
        });
      }
    }

    const userMessageMatch = commit.message.match(/<V8UserMessage>([\s\S]*?)<\/V8UserMessage>/);
    const userMatched = userMessageMatch && userMessageMatch[1];

    if (userMatched) {
      const userContent = userMessageMatch[1].trim();

      if (userContent) {
        messages.push({
          id: `user-${commit.id}`,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: userContent,
            },
          ],
          metadata: {
            createdAt: new Date(commit.created_at),
          },
        });
      }
    }

    const isInitialCommit = (message: string) => {
      return message.toLowerCase().trim() === 'initial commit' || message.toLowerCase().trim() === 'add readme.md';
    };

    if (!assistantMatched && !userMatched) {
      messages.push({
        id: `commit-${commit.id}`,
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: commit.message,
          },
        ],
        metadata: {
          createdAt: new Date(commit.created_at),
          annotations: isInitialCommit(commit.message) ? ['hidden'] : [],
        },
      });
    }
  });

  return messages;
};
