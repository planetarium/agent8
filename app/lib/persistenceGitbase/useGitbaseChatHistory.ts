import { useState, useEffect, useCallback, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { FileMap } from '~/lib/stores/files';
import { repoStore } from '~/lib/stores/repo';
import {
  getProjectCommits,
  fetchProjectFiles,
  revertBranch,
  getRestorePoint,
  getRestoreHistory,
} from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { createScopedLogger } from '~/utils/logger';
import { lastActionStore } from '~/lib/stores/lastAction';
import type { RestoreHistoryEntry } from '~/lib/persistenceGitbase/gitlabService';
import { restoreEventStore } from '~/lib/stores/restore';

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
  const [files, setFiles] = useState<FileMap>({});
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
      untilCommit,
      fileCommit,
      force,
    }: {
      page?: number;
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

      if (!force) {
        // 이미 로딩 중이면 종료
        if (loading) {
          return;
        }

        if (
          projectPath === prevRequestParams.current.projectPath &&
          page === prevRequestParams.current.page &&
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
        prevRequestParams.current = {
          projectPath,
          page,
          untilCommit,
        };

        if (page === 1) {
          if (Object.keys(files).length > 0) {
            lastActionStore.set({ action: 'LOAD' });
          }

          await loadFiles(projectPath, fileCommit || untilCommit || undefined);
        }

        const data = (await getProjectCommits(projectPath, {
          branch: 'develop',
          untilCommit,
          page,
          all: true, // 모든 브랜치의 커밋을 포함
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

        // Sort commits by time (most recent first) since we're getting from all branches
        const sortedCommits = data.data.commits.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        // Set latest commit hash from the first commit (most recent)
        if (sortedCommits.length > 0) {
          repoStore.setKey('latestCommitHash', sortedCommits[0].id);
        }

        const newMessages = parseCommitMessages(sortedCommits);

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

              restoreMessages = filteredHistory.map((entry: RestoreHistoryEntry) => {
                return {
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
                };
              });
            }
          }
        } catch (err) {
          logger.warn('Failed to load restore history:', err);
        }

        if (page > 1) {
          /*
           * Load More: Merge new messages with restore messages and existing chats, then sort
           * Filter restore messages to avoid duplicates with existing ones
           */
          //
          setChats((prevChats) => {
            // Get existing restore message IDs to avoid duplicates
            const existingRestoreIds = new Set(
              prevChats
                .filter((msg) => (msg.metadata as any)?.annotations?.includes('restore-message'))
                .map((msg) => msg.id),
            );

            // Filter out already added restore messages
            const newRestoreMessages = restoreMessages.filter((msg) => !existingRestoreIds.has(msg.id));

            const allMessages = [...newMessages, ...newRestoreMessages, ...prevChats];

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
            /*
             * Check if a new commit was created after the restore.
             * If so, ignore the restore point and load latest files.
             */
            const [latestCommitData, restoreHistory] = await Promise.all([
              getProjectCommits(projectPath, { branch: 'develop', page: 1 }),
              getRestoreHistory(projectPath),
            ]);

            if (latestCommitData.success && latestCommitData.data.commits.length > 0) {
              const latestCommit = latestCommitData.data.commits[0];
              const latestCommitTime = new Date(latestCommit.created_at).getTime();

              const restoreEntry = restoreHistory.find(
                (entry: RestoreHistoryEntry) => entry.commitHash === savedRestorePoint,
              );

              if (restoreEntry) {
                const restoredAt = new Date(restoreEntry.restoredAt).getTime();

                // Only use restore point if no new commit after restore
                if (latestCommitTime <= restoredAt) {
                  revertToCommit = savedRestorePoint;
                } else {
                  logger.info('New commit found after restore, ignoring saved restore point');
                }
              } else {
                // No restore entry found, use the saved restore point
                revertToCommit = savedRestorePoint;
              }
            } else {
              // Couldn't fetch commits, use the saved restore point as fallback
              revertToCommit = savedRestorePoint;
            }
          }
        } catch (err) {
          console.warn('Failed to get restore point from GitLab:', err);
        }
      }

      // Initial load on mount or projectPath change
      if (projectPath && projectPath !== prevRequestParams.current.projectPath) {
        // Always load all chat history (don't filter by untilCommit)
        load({ page: 1, fileCommit: revertToCommit, untilCommit: undefined });
      }
    };

    initializeLoad();

    const unsubscribe = repoStore.subscribe(async () => {
      if (projectPath !== prevRequestParams.current.projectPath) {
        // Read revertTo from URL or GitLab
        const url = new URL(window.location.href);
        const revertToParam = url.searchParams.get('revertTo');
        let revertToCommit = revertToParam && isCommitHash(revertToParam) ? revertToParam : undefined;

        if (!revertToCommit && projectPath) {
          try {
            const savedRestorePoint = await getRestorePoint(projectPath);

            if (savedRestorePoint && isCommitHash(savedRestorePoint)) {
              // Check if a new commit was created after the restore
              const [latestCommitData, restoreHistory] = await Promise.all([
                getProjectCommits(projectPath, { branch: 'develop', page: 1 }),
                getRestoreHistory(projectPath),
              ]);

              if (latestCommitData.success && latestCommitData.data.commits.length > 0) {
                const latestCommit = latestCommitData.data.commits[0];
                const latestCommitTime = new Date(latestCommit.created_at).getTime();

                const restoreEntry = restoreHistory.find(
                  (entry: RestoreHistoryEntry) => entry.commitHash === savedRestorePoint,
                );

                if (restoreEntry) {
                  const restoredAt = new Date(restoreEntry.restoredAt).getTime();

                  if (latestCommitTime <= restoredAt) {
                    revertToCommit = savedRestorePoint;
                  } else {
                    logger.info('New commit found after restore, ignoring saved restore point');
                  }
                } else {
                  revertToCommit = savedRestorePoint;
                }
              } else {
                revertToCommit = savedRestorePoint;
              }
            }
          } catch (err) {
            console.warn('Failed to get restore point from GitLab:', err);
          }
        }

        load({ page: 1, fileCommit: revertToCommit, untilCommit: undefined });
      }
    });

    return () => unsubscribe();
  }, [load, projectPath]);

  // Subscribe to restore events - only update cached history (Chat component handles UI)
  useEffect(() => {
    const unsubscribe = restoreEventStore.subscribe((event) => {
      if (event && loaded) {
        // Update cached restore history with new entry (for future page loads)
        const newEntry: RestoreHistoryEntry = {
          commitHash: event.commitHash,
          commitTitle: event.commitTitle,
          restoredAt: new Date().toISOString(),
        };

        setCachedRestoreHistory((prevHistory) => [newEntry, ...prevHistory].slice(0, 200));

        /*
         * Note: We don't update chats here because it would overwrite current session messages.
         * The Chat component handles adding restore message to initialMessages directly.
         */
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
        await revertBranch(projectPath, 'develop', hash);
        await load({ page: 1, untilCommit: hash, force: true });
      } finally {
        setLoading(false);
      }
    },
    project,
    files,
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
