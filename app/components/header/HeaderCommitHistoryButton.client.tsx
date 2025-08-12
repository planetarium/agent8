import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { repoStore } from '~/lib/stores/repo';
import { Dialog, DialogTitle } from '~/components/ui/Dialog';
import { DialogRoot } from '~/components/ui/Dialog';
import { Button } from '~/components/ui/Button';
import * as RadixDialog from '@radix-ui/react-dialog';
import { forkProject } from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { toast } from 'react-toastify';
import { handleChatError } from '~/utils/errorNotification';

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

interface CommitResponse {
  success: boolean;
  data?: {
    project: {
      id: number;
      name: string;
      description: string;
    };
    commits: Commit[];
    pagination: {
      total: number;
      page: number;
      perPage: number;
      hasMore: boolean;
      totalPages: number;
    };
  };
  message?: string;
}

export function HeaderCommitHistoryButton() {
  const repo = useStore(repoStore);
  const [isOpen, setIsOpen] = useState(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const perPage = 50;

  const fetchCommits = async (page: number = 1, append: boolean = false) => {
    if (!repo.path) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        projectPath: repo.path,
        all: 'true',
        page: page.toString(),
        perPage: perPage.toString(),
      });

      const response = await fetch(`/api/gitlab/commits?${params}`);
      const data: CommitResponse = await response.json();

      if (data.success && data.data) {
        const filteredCommits = data.data.commits.filter((commit) => !commit.message.startsWith('Merge branch'));
        const reversedCommits = [...filteredCommits].reverse();

        if (append) {
          setCommits((prev) => [...prev, ...reversedCommits]);
        } else {
          setCommits(reversedCommits);
        }

        setHasMore(data.data.pagination.hasMore);
        setCurrentPage(page);

        console.log('Pagination info:', {
          hasMore: data.data.pagination.hasMore,
          currentPage: page,
          totalPages: data.data.pagination.totalPages,
          total: data.data.pagination.total,
        });
      } else {
        setError(data.message || 'Failed to fetch commits');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);

    if (open && commits.length === 0) {
      fetchCommits(1);
    }
  };

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      fetchCommits(currentPage + 1, true);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getGitlabCommitUrl = (commitId: string) => {
    if (!repo.path) {
      return '';
    }

    return `https://gitlab.verse8.io/${repo.path}/-/commit/${commitId}`;
  };

  const handleFork = async (commit: Commit) => {
    const commitHash = commit.id;

    if (!commitHash || !isCommitHash(commitHash)) {
      handleChatError('No commit hash found', undefined, 'handleFork - commit hash validation');
      return;
    }

    const nameWords = repo.name.split('-');

    let newRepoName = '';

    if (nameWords && Number.isInteger(Number(nameWords[nameWords.length - 1]))) {
      newRepoName = nameWords.slice(0, -1).join('-');
    } else {
      newRepoName = nameWords.join('-');
    }

    // Show loading toast while forking
    const toastId = toast.loading('Forking project...');

    try {
      const forkedProject = await forkProject(repo.path, newRepoName, commitHash, repo.title);

      // Dismiss the loading toast
      toast.dismiss(toastId);

      if (forkedProject && forkedProject.success) {
        toast.success('Forked project successfully');
        window.open('/chat/' + forkedProject.project.path, '_blank');
      } else {
        handleChatError('Failed to fork project', undefined, 'handleFork - fork result check');
      }
    } catch (error) {
      // Dismiss the loading toast and show error
      toast.dismiss(toastId);
      handleChatError(
        'Failed to fork project',
        error instanceof Error ? error : String(error),
        'handleFork - catch block',
      );
    }
  };

  if (!repo.path) {
    return null;
  }

  return (
    <DialogRoot open={isOpen} onOpenChange={handleOpenChange}>
      <RadixDialog.Trigger asChild>
        <button className="text-bolt-elements-textSecondary bg-transparent hover:text-bolt-elements-textPrimary transition-colors text-sm font-medium flex items-center gap-2">
          <span className="i-ph:git-branch-duotone" />
          <span>History</span>
        </button>
      </RadixDialog.Trigger>
      <Dialog
        className="max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col bg-zinc-900 border-zinc-700"
        onClose={() => setIsOpen(false)}
      >
        <div className="p-6 border-b border-zinc-700 bg-gradient-to-r from-zinc-800 to-zinc-900">
          <DialogTitle className="text-xl font-bold text-zinc-100 flex items-center gap-3">
            <div className="i-ph:git-branch-duotone text-zinc-400" />
            Commit History
            <span className="text-sm font-normal text-zinc-400">({repo.path})</span>
          </DialogTitle>
        </div>

        <div className="flex-1 overflow-y-auto p-6 max-h-[50vh] bg-zinc-900" style={{ scrollbarWidth: 'thin' }}>
          {loading && commits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-zinc-600 border-t-zinc-400 mb-4"></div>
              <div className="text-zinc-400 text-sm">Loading commits...</div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="i-ph:warning-circle-duotone text-red-400 text-4xl mb-4 mx-auto" />
              <div className="text-red-400 mb-4 font-medium">Error: {error}</div>
              <Button
                onClick={() => fetchCommits(1)}
                variant="secondary"
                size="sm"
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-600"
              >
                <div className="i-ph:arrow-clockwise mr-2" />
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {commits.map((commit, index) => (
                <div
                  key={`${commit.id}-${index}`}
                  className="bg-gradient-to-r from-zinc-800 to-zinc-850 border border-zinc-700 rounded-xl p-5 hover:from-zinc-750 hover:to-zinc-800 hover:border-zinc-600 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-zinc-100 leading-relaxed break-words text-base">
                          {commit.title || commit.message.split('\n')[0]}
                        </div>
                      </div>
                      <a
                        href={getGitlabCommitUrl(commit.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-zinc-400 hover:text-zinc-400 hover:bg-zinc-700 rounded-lg transition-all duration-200 flex-shrink-0 group"
                        title="View in GitLab"
                      >
                        <div className="i-ph:arrow-square-out text-base group-hover:scale-110 transition-transform" />
                      </a>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleFork(commit)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-300 bg-zinc-700 hover:text-zinc-200 hover:bg-zinc-600 rounded transition-all duration-200"
                          title="Fork from this commit"
                        >
                          <div className="i-ph:git-fork text-sm" />
                          Fork
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <div className="i-ph:clock text-zinc-500" />
                        {formatDate(commit.committed_date)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {(hasMore || commits.length > 0) && (
                <div className="text-center py-6">
                  <Button
                    onClick={handleLoadMore}
                    disabled={loading || !hasMore}
                    variant="secondary"
                    size="sm"
                    className={`min-w-[140px] transition-all duration-200 ${
                      hasMore
                        ? 'bg-gradient-to-r from-zinc-600 to-zinc-700 hover:from-zinc-500 hover:to-zinc-600 text-white border-zinc-500 shadow-lg hover:shadow-xl'
                        : 'bg-zinc-700 text-zinc-400 border-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    {loading ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-400 border-t-white"></div>
                        Loading...
                      </div>
                    ) : hasMore ? (
                      <div className="flex items-center gap-2">
                        <div className="i-ph:arrow-down" />
                        Load More
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="i-ph:check-circle" />
                        All Loaded
                      </div>
                    )}
                  </Button>
                </div>
              )}

              {commits.length === 0 && !loading && (
                <div className="text-center py-16">
                  <div className="i-ph:git-branch-duotone text-zinc-600 text-6xl mb-4 mx-auto" />
                  <div className="text-zinc-400 text-lg font-medium mb-2">No commits found</div>
                  <div className="text-zinc-500 text-sm">This repository doesn't have any commits yet.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </DialogRoot>
  );
}
