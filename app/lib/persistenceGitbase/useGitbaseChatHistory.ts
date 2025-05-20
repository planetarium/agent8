import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message } from 'ai';
import type { FileMap } from '~/lib/stores/files';
import { repoStore } from '~/lib/stores/repo';
import { getProjectCommits, fetchProjectFiles, getTaskBranches } from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { lastActionStore } from '~/lib/stores/lastAction';

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
  const [chats, setChats] = useState<Message[]>([]);
  const [enabledTaskMode, setEnabledTaskMode] = useState(true);
  const [taskBranch, setTaskBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<FileMap>({});
  const [taskBranches, setTaskBranches] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [untilCommit, setUntilCommit] = useState<string | null>(null);

  // 이전 요청 매개변수를 추적하기 위한 ref
  const prevRequestParams = useRef<string | null>(null);

  const getRevertTo = () => {
    const url = new URL(window.location.href);
    const revertTo = url.searchParams.get('revertTo');

    return revertTo && isCommitHash(revertTo) ? revertTo : null;
  };

  useEffect(() => {
    const unsubscribe = repoStore.subscribe((state) => {
      setTaskBranch(state.taskBranch);
    });
    return () => unsubscribe();
  }, []);

  const loadTaskBranches = useCallback(async (projectPath: string) => {
    const { data } = await getTaskBranches(projectPath);
    setTaskBranches(data);
  }, []);

  const loadFiles = useCallback(
    async (projectPath: string) => {
      if (!projectPath) {
        return;
      }

      try {
        setFilesLoaded(false);

        setLoadingFiles(true);

        const fileMap = await fetchProjectFiles(projectPath, getRevertTo() || taskBranch || undefined);

        setFiles(fileMap);
        setFilesLoaded(true);
      } catch (fileError) {
        logger.error('Error fetching project files:', fileError);
      } finally {
        setLoadingFiles(false);
      }
    },
    [fetchProjectFiles, taskBranch],
  );

  const load = useCallback(
    async (page: number = 1, append: boolean = false) => {
      if (!projectPath) {
        setLoaded(true);
        return;
      }

      // 이미 로딩 중이면 종료
      if (loading) {
        return;
      }

      setLoaded(false);
      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams({
          projectPath,
          page: page.toString(),
        });

        if (taskBranch) {
          queryParams.append('branch', taskBranch);
        }

        const untilCommit = getRevertTo();

        if (untilCommit) {
          queryParams.append('untilCommit', untilCommit);
        }

        const requestParamsString = queryParams.toString();

        // 동일한 요청 파라미터로 이미 요청한 경우 (페이지가 다른 경우 제외)
        if (!append && prevRequestParams.current === requestParamsString) {
          setLoaded(true);
          setLoading(false);

          return;
        }

        if (page === 1) {
          if (Object.keys(files).length > 0) {
            lastActionStore.set({ action: 'LOAD' });
          }

          await Promise.all([loadFiles(projectPath), loadTaskBranches(projectPath)]);
        }

        // 현재 요청 파라미터 저장
        prevRequestParams.current = requestParamsString;

        const data = (await getProjectCommits(projectPath, {
          branch: taskBranch || undefined,
          untilCommit: untilCommit || undefined,
          page,
        })) as CommitResponse;

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch commit history');
        }

        setProject(data.data.project);

        const newMessages = parseCommitMessages(data.data.commits);

        if (append) {
          setChats((prevChats) => [...prevChats, ...newMessages.reverse()]);
        } else {
          setChats(newMessages.reverse());
        }

        setLoaded(true);
        setCurrentPage(page);
        setHasMore(data.data.pagination.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error fetching commit history');
        logger.error('Error fetching commit history:', err);
      } finally {
        setLoaded(true);
        setLoading(false);
      }
    },
    [projectPath, loading, fetchProjectFiles, taskBranch],
  );

  // Load more commits
  const loadBefore = useCallback(async () => {
    if (loading || !hasMore) {
      return;
    }

    await load(currentPage + 1, true);
  }, [loading, hasMore, currentPage, load, taskBranch]);

  // popstate 이벤트 리스너 추가 (브라우저 뒤로가기/앞으로가기 시 처리)
  useEffect(() => {
    const handleChangeState = () => {
      const revertTo = getRevertTo();

      // 현재 URL의 revertTo 값이 상태의 값과 다르면 데이터 다시 로드
      if (revertTo !== untilCommit) {
        setUntilCommit(revertTo);
      } else {
        setUntilCommit(null);
      }
    };

    window.addEventListener('popstate', handleChangeState);
    window.addEventListener('urlchange', handleChangeState);

    return () => {
      window.removeEventListener('popstate', handleChangeState);
      window.removeEventListener('urlchange', handleChangeState);
    };
  }, [untilCommit]);

  // Initial load - useEffect 최적화
  useEffect(() => {
    // repo가 없으면 초기화만 하고 API 호출 안함
    if (!projectPath) {
      setLoaded(true);
      setFilesLoaded(true);
      setChats([]);
      setFiles({});

      return () => 0;
    }

    const timeoutId = setTimeout(async () => {
      load(1, false);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [projectPath, load, loadFiles, loadTaskBranches, untilCommit, taskBranch]);

  return {
    loaded: loaded && filesLoaded,
    chats,
    project,
    files,
    taskBranches,
    reloadTaskBranches: loadTaskBranches,
    enabledTaskMode,
    setEnabledTaskMode,
    loading: loading || loadingFiles,
    error,
    hasMore,
    loadBefore,
  };
}

const parseCommitMessages = (commits: Commit[]): Message[] => {
  const messages: Message[] = [];

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
          content: assistantContent,
          parts: [
            {
              type: 'text',
              text: assistantContent,
            },
          ],
          createdAt: new Date(commit.created_at),
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
          content: userContent,
          parts: [
            {
              type: 'text',
              text: userContent,
            },
          ],
          createdAt: new Date(commit.created_at),
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
        content: commit.message,
        parts: [
          {
            type: 'text',
            text: commit.message,
          },
        ],
        createdAt: new Date(commit.created_at),
        annotations: isInitialCommit(commit.message) ? ['hidden'] : [],
      });
    }
  });

  return messages;
};
