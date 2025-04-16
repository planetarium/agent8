import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message } from 'ai';
import type { FileMap } from '~/lib/stores/files';
import { repoStore } from '~/lib/stores/repo';
import { getProjectCommits, fetchProjectFiles } from '~/lib/persistenceGitbase/api.client';
import { useSearchParams } from '@remix-run/react';
import { isCommitHash } from './utils';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useGitbaseChatHistory');

interface RepoChatsOptions {
  branch?: string;
  untilCommit?: string;
  perPage?: number;
}

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

export function useGitbaseChatHistory(options: RepoChatsOptions = {}) {
  const repoId = repoStore.get().path;
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
  const [files, setFiles] = useState<FileMap>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [untilCommit, setUntilCommit] = useState<string | null>(null);

  const [searchParams] = useSearchParams();

  // 이전 요청 매개변수를 추적하기 위한 ref
  const prevRequestParams = useRef<string | null>(null);

  // 옵션 객체를 ref로 저장하여 불필요한 리렌더링 방지
  const optionsRef = useRef(options);

  useEffect(() => {
    const revertTo = ((r: string | null) => {
      if (r && isCommitHash(r)) {
        return r;
      }

      return null;
    })(searchParams.get('revertTo'));

    setUntilCommit(revertTo);
  }, [searchParams]);

  // 옵션이 변경되면 ref를 업데이트
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Parse commit messages to extract user and assistant messages
  const parseCommitMessages = useCallback((commits: Commit[]): Message[] => {
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
  }, []);

  const loadFiles = useCallback(async () => {
    if (!repoId) {
      return;
    }

    try {
      setFilesLoaded(false);

      setLoadingFiles(true);

      const fileMap = await fetchProjectFiles(repoId, untilCommit || undefined);

      setFiles(fileMap);
      setFilesLoaded(true);
    } catch (fileError) {
      logger.error('Error fetching project files:', fileError);
    } finally {
      setLoadingFiles(false);
    }
  }, [repoId, fetchProjectFiles, untilCommit]);

  // Fetch commits from the API
  const fetchCommits = useCallback(
    async (page: number = 1, append: boolean = false) => {
      if (!repoId) {
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
        const currentOptions = optionsRef.current;

        const queryParams = new URLSearchParams({
          projectPath: repoId,
          page: page.toString(),
        });

        if (currentOptions.branch) {
          queryParams.append('branch', currentOptions.branch);
        }

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

        // 현재 요청 파라미터 저장
        prevRequestParams.current = requestParamsString;

        if (page === 1) {
          loadFiles();
        }

        const data = (await getProjectCommits(repoId, {
          branch: currentOptions.branch,
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
    [repoId, loading, parseCommitMessages, fetchProjectFiles, untilCommit],
  );

  // Load more commits
  const loadBefore = useCallback(async () => {
    if (loading || !hasMore) {
      return;
    }

    await fetchCommits(currentPage + 1, true);
  }, [loading, hasMore, currentPage, fetchCommits, untilCommit]);

  // popstate 이벤트 리스너 추가 (브라우저 뒤로가기/앞으로가기 시 처리)
  useEffect(() => {
    const handleChangeState = () => {
      const url = new URL(window.location.href);
      const urlRevertTo = url.searchParams.get('revertTo');

      // 현재 URL의 revertTo 값이 상태의 값과 다르면 데이터 다시 로드
      if ((urlRevertTo && isCommitHash(urlRevertTo)) !== untilCommit) {
        setUntilCommit(urlRevertTo);
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
    if (!repoId) {
      setLoaded(true);
      setFilesLoaded(true);
      setChats([]);
      setFiles({});

      return () => 0;
    }

    const timeoutId = setTimeout(() => {
      fetchCommits(1, false);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [repoId, fetchCommits, loadFiles, untilCommit]);

  return {
    loaded: loaded && filesLoaded,
    chats,
    project,
    files,
    loading: loading || loadingFiles,
    error,
    hasMore,
    loadBefore,
  };
}
