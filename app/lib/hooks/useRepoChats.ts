import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message } from 'ai';
import { generateId } from '~/utils/fileUtils';
import JSZip from 'jszip';
import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR } from '~/utils/constants';
import { repoStore } from '~/lib/stores/repo';
import { downloadProjectZip, getProjectCommits } from '~/lib/repoManager/client';

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
    commits: Commit[];
    pagination: PaginationInfo;
  };
  error?: string;
}

export function useRepoChats(options: RepoChatsOptions = {}) {
  const repoId = repoStore.get().path;
  const [chats, setChats] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileMap>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이전 요청 매개변수를 추적하기 위한 ref
  const prevRequestParams = useRef<string | null>(null);

  // 옵션 객체를 ref로 저장하여 불필요한 리렌더링 방지
  const optionsRef = useRef(options);

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
            id: `assistant-${commit.id}-${generateId()}`,
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
            id: `user-${commit.id}-${generateId()}`,
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

      if (!assistantMatched && !userMatched && commit.message.toLowerCase().trim() !== 'initial commit') {
        messages.push({
          id: `commit-${commit.id}-${generateId()}`,
          role: 'assistant',
          content: commit.message,
          parts: [
            {
              type: 'text',
              text: commit.message,
            },
          ],
          createdAt: new Date(commit.created_at),
        });
      }
    });

    return messages;
  }, []);

  // Fetch project files
  const fetchProjectFiles = useCallback(async (projectPath: string): Promise<FileMap> => {
    setLoadingFiles(true);

    try {
      const zipBlob = await downloadProjectZip(projectPath);

      // Load zip file using JSZip
      const zip = await JSZip.loadAsync(zipBlob);

      // Process zip contents into FileMap structure
      const fileMap: FileMap = {};
      const dirSet = new Set<string>(); // 디렉토리 경로 추적용 Set

      // 먼저 모든 디렉토리 경로를 수집
      zip.forEach((relativePath) => {
        // 경로에서 첫 번째 폴더(프로젝트 루트)를 제거
        const pathParts = relativePath.split('/');

        if (pathParts.length > 1) {
          pathParts.shift(); // 첫 번째 경로 부분(프로젝트 폴더) 제거
        }

        // 파일 경로의 모든 상위 디렉토리를 찾아 dirSet에 추가
        if (pathParts.length > 1) {
          for (let i = 1; i < pathParts.length; i++) {
            const dirPath = pathParts.slice(0, i).join('/');

            if (dirPath) {
              dirSet.add(dirPath);
            }
          }
        }
      });

      // 디렉토리 먼저 FileMap에 추가
      dirSet.forEach((dirPath) => {
        const fullPath = `${WORK_DIR}/${dirPath}`;
        fileMap[fullPath] = {
          type: 'folder',
        };
      });

      const promises: Promise<void>[] = [];

      // 파일 처리
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          const promise = zipEntry.async('string').then((content) => {
            // 경로에서 첫 번째 폴더(프로젝트 루트)를 제거
            const pathParts = relativePath.split('/');

            if (pathParts.length > 1) {
              pathParts.shift(); // 첫 번째 경로 부분(프로젝트 폴더) 제거
            }

            const filePath = pathParts.join('/');
            const fullPath = `${WORK_DIR}/${filePath}`;

            // FileMap에 추가
            fileMap[fullPath] = {
              type: 'file',
              content,
              isBinary: false,
            };
          });

          promises.push(promise);
        }
      });

      await Promise.all(promises);

      return fileMap;
    } catch (error) {
      console.error('Error fetching project files:', error);
      throw error;
    } finally {
      setLoadingFiles(false);
    }
  }, []);

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

        if (currentOptions.untilCommit) {
          queryParams.append('untilCommit', currentOptions.untilCommit);
        }

        const requestParamsString = queryParams.toString();

        // 동일한 요청 파라미터로 이미 요청한 경우 (페이지가 다른 경우 제외)
        if (!append && prevRequestParams.current === requestParamsString) {
          setLoading(false);
          return;
        }

        // 현재 요청 파라미터 저장
        prevRequestParams.current = requestParamsString;

        const data = (await getProjectCommits(repoId, {
          branch: currentOptions.branch,
          untilCommit: currentOptions.untilCommit,
          page,
        })) as CommitResponse;

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch commit history');
        }

        const newMessages = parseCommitMessages(data.data.commits);

        // 첫 페이지를 로드하고 append가 아닌 경우에만 파일을 가져옴
        if (page === 1 && !append) {
          try {
            const fileMap = await fetchProjectFiles(repoId);
            setFiles(fileMap);

            // fileMap과 chats가 모두 로드되면 ready 상태를 true로 설정
            if (Object.keys(fileMap).length > 0 && newMessages.length > 0) {
              setLoaded(true);
            }
          } catch (fileError) {
            console.error('Error fetching project files:', fileError);

            // 파일 로드 실패해도 메시지는 표시
            if (newMessages.length > 0) {
              setLoaded(true);
            }
          }
        }

        if (append) {
          setChats((prevChats) => [...prevChats, ...newMessages.reverse()]);
        } else {
          setChats(newMessages.reverse());
        }

        setCurrentPage(page);
        setHasMore(data.data.pagination.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error fetching commit history');
        console.error('Error fetching commit history:', err);
      } finally {
        setLoading(false);
      }
    },
    [repoId, loading, parseCommitMessages, fetchProjectFiles],
  );

  // Load more commits
  const loadBefore = useCallback(async () => {
    if (loading || !hasMore) {
      return;
    }

    await fetchCommits(currentPage + 1, true);
  }, [loading, hasMore, currentPage, fetchCommits]);

  // Initial load - useEffect 최적화
  useEffect(() => {
    // repo가 없으면 초기화만 하고 API 호출 안함
    if (!repoId) {
      setLoaded(true);
      setChats([]);
      setFiles({});

      return () => 0;
    }

    // 다음 프레임에서 데이터 로드 (디바운싱 효과)
    const timeoutId = setTimeout(() => {
      fetchCommits(1, false);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [repoId, fetchCommits]);

  return {
    loaded: loaded && !loadingFiles,
    chats,
    files,
    loading: loading || loadingFiles,
    error,
    hasMore,
    loadBefore,
  };
}
