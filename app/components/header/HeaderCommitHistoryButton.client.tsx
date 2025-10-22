import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';

import { repoStore } from '~/lib/stores/repo';
import { forkProject, fetchProjectFiles, setRestorePoint } from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { handleChatError } from '~/utils/errorNotification';
import { workbenchStore } from '~/lib/stores/workbench';
import { convertFileMapToFileSystemTree } from '~/utils/fileUtils';
import { triggerRestoreEvent } from '~/lib/stores/restore';

import { Button } from '~/components/ui/Button';
import CustomButton from '~/components/ui/CustomButton';
import { HistoryIcon, CloseIcon, OutLinkIcon, ForkIcon, RestoreIcon } from '~/components/ui/Icons';

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

// Restore Confirmation Modal Component
interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  commit: Commit | null;
}

function RestoreConfirmModal({ isOpen, onClose, onConfirm, commit }: RestoreConfirmModalProps) {
  if (!isOpen || !commit) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="flex flex-col items-start gap-[12px] border border-[rgba(255,255,255,0.22)] bg-[#111315] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)] w-[500px] p-[32px] rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-center items-start gap-2 self-stretch">
          <span className="text-primary text-heading-md flex-[1_0_0]">
            Are you sure you want to restore this commit?
          </span>
          <button onClick={onClose} className="bg-transparent p-2 justify-center items-center gap-1.5">
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-start pb-4 gap-4 self-stretch">
          <span className="text-body-md-medium text-tertiary self-stretch">
            Changes will be applied to this project. Publishing will update the existing project.
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-start gap-[10px] self-stretch">
          <div className="flex justify-end items-center gap-3 self-stretch">
            <CustomButton variant="secondary-ghost" size="lg" onClick={onClose}>
              Cancel
            </CustomButton>
            <CustomButton variant="primary-filled" size="lg" onClick={onConfirm}>
              <RestoreIcon size={24} color="#f3f5f8" />
              Restore
            </CustomButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function HeaderCommitHistoryButton() {
  const repo = useStore(repoStore);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [showGradient, setShowGradient] = useState<boolean>(true);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState<boolean>(false);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);

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

    if (open) {
      setShowGradient(true); // Reset gradient visibility when opening
    }
  };

  // Fetch commits when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchCommits(1);
    }
  }, [isOpen]);

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      fetchCommits(currentPage + 1, true);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    // Check if user is near the bottom (within 100px)
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

    setShowGradient(!isNearBottom);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const formatted = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    });

    return `${formatted} UTC ${time}`;
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
      const forkedProject = await forkProject(repo.path, newRepoName, commitHash, repo.title, {
        resetEnv: true,
      });

      // Dismiss the loading toast
      toast.dismiss(toastId);

      if (forkedProject && forkedProject.success) {
        toast.success('Forked project successfully');
        window.location.href = '/chat/' + forkedProject.project.path;
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

  // Open restore confirmation modal
  const handleRestoreClick = (commit: Commit) => {
    setSelectedCommit(commit);
    setIsRestoreModalOpen(true);
  };

  // Actual restore logic after confirmation
  const handleRestoreConfirm = async () => {
    if (!selectedCommit) {
      return;
    }

    const commitHash = selectedCommit.id;

    if (!commitHash || !isCommitHash(commitHash)) {
      handleChatError('No commit hash found', undefined, 'handleRestore - commit hash validation');
      return;
    }

    const toastId = toast.loading('Restoring project...');

    try {
      // Fetch files from the specific commit
      const files = await fetchProjectFiles(repo.path, commitHash);

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found in commit');
      }

      // Get container instance
      const containerInstance = await workbenchStore.container;

      // Remove existing directories
      try {
        await containerInstance.fs.rm('/src', { recursive: true, force: true });
        await containerInstance.fs.rm('/PROJECT', { recursive: true, force: true });
      } catch {
        // Ignore error if directories don't exist
      }

      // Mount the files from the commit
      await containerInstance.mount(convertFileMapToFileSystemTree(files));
      workbenchStore.resetAllFileModifications();

      // Refresh preview if it exists
      const previews = workbenchStore.previews.get();
      const currentPreview = previews.find((p: any) => p.ready);

      if (currentPreview) {
        workbenchStore.previews.set(
          previews.map((p: any) => {
            if (p.baseUrl === currentPreview.baseUrl) {
              return { ...p, refreshAt: Date.now() };
            }

            return p;
          }),
        );
      }

      // Save restore point to GitLab
      try {
        await setRestorePoint(repo.path, commitHash, selectedCommit.title);
      } catch (err) {
        console.warn('Failed to save restore point to GitLab:', err);

        // Continue even if saving fails
      }

      // Update URL with revertTo parameter to ensure commits are based on this version
      window.history.replaceState(null, '', `/chat/${repo.path}?revertTo=${commitHash}`);

      // Trigger restore event to add message to chat immediately
      triggerRestoreEvent(commitHash, selectedCommit.title);

      toast.dismiss(toastId);
      toast.success('Project restored successfully');
      setIsRestoreModalOpen(false);
      setIsOpen(false);
    } catch (error) {
      toast.dismiss(toastId);
      handleChatError(
        'Failed to restore project',
        error instanceof Error ? error : String(error),
        'handleRestore - restore process',
      );
    }
  };

  if (!repo.path) {
    return null;
  }

  return (
    <>
      <button
        className="text-bolt-elements-textSecondary bg-transparent hover:text-bolt-elements-textPrimary transition-colors text-sm font-medium flex items-center gap-2"
        onClick={() => handleOpenChange(true)}
      >
        <HistoryIcon width={20} height={20} />
        <span className="text-heading-xs text-interactive-on-primary hover:text-[#FCFCFD] active:text-[#FFFFFF]">
          Commit History
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 bg-[rgba(0, 0, 0, 0.60)] backdrop-blur-[4px] flex items-center justify-center z-50"
            onClick={() => setIsOpen(false)}
          >
            <div
              className="max-w-[800px] w-full overflow-hidden flex flex-col items-start bg-primary border border-secondary rounded-2xl elevation-light-3 gap-3 p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex items-cennter gap-2 self-stretch">
                <h1 className="text-heading-md text-primary flex-[1_0_0]">Commit History</h1>
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex p-2 justify-center items-center gap-1.5 bg-transparent"
                >
                  <CloseIcon width={20} height={20} />
                </button>
              </header>

              <div className="relative flex-[1_0_0] self-stretch">
                <div
                  className="flex flex-col h-[600px] items-start gap-3 overflow-y-auto self-stretch"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
                  }}
                  onScroll={handleScroll}
                >
                  {loading && commits.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full w-full">
                      <div className="animate-spin rounded-full h-10 w-10 border-2 border-zinc-600 border-t-zinc-400 mb-4"></div>
                      <div className="text-zinc-400 text-sm">Loading commits...</div>
                    </div>
                  ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full w-full">
                      <div className="i-ph:warning-circle-duotone text-red-400 text-4xl mb-4" />
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
                    <>
                      {commits.map((commit, index) => (
                        <div
                          key={`${commit.id}-${index}`}
                          className="flex flex-col items-center justify-center gap-3 p-3 self-stretch rounded-lg border border-interactive-neutral"
                        >
                          <div className="flex items-center gap-2 self-stretch">
                            <span className="text-heading-sm text-primary flex-[1_0_0] line-clamp-1 overflow-hidden text-ellipsis">
                              {commit.title || commit.message.split('\n')[0]}
                            </span>
                          </div>
                          <div className="flex justify-between items-center self-stretch">
                            <span className="text-body-md-medium text-tertiary">
                              {formatDate(commit.committed_date)}
                            </span>
                            <div className="flex items-center gap-3">
                              <CustomButton variant="secondary-text" size="md" asChild>
                                <a
                                  href={getGitlabCommitUrl(commit.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="View in GitLab"
                                >
                                  <span>Gitlab</span>
                                  <OutLinkIcon size={20} />
                                </a>
                              </CustomButton>
                              <CustomButton variant="secondary-ghost" size="md" onClick={() => handleFork(commit)}>
                                <ForkIcon size={20} />
                                <span>Fork</span>
                              </CustomButton>
                              <CustomButton
                                variant="secondary-ghost"
                                size="md"
                                onClick={() => handleRestoreClick(commit)}
                              >
                                <RestoreIcon size={20} />
                                <span className="text-interactive-primary">Restore</span>
                              </CustomButton>
                            </div>
                          </div>
                        </div>
                      ))}

                      {(hasMore || commits.length > 0) && (
                        <div className="flex justify-center py-6 w-full">
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
                        <div className="flex flex-col items-center justify-center h-full w-full">
                          <div className="i-ph:git-branch-duotone text-zinc-600 text-6xl mb-4" />
                          <div className="text-zinc-400 text-lg font-medium mb-2">No commits found</div>
                          <div className="text-zinc-500 text-sm">This repository doesn't have any commits yet.</div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Gradient overlay when there are 7+ commits and not scrolled to bottom */}
                {commits.length >= 7 && showGradient && (
                  <div
                    className="absolute left-0 right-0 bottom-0 pointer-events-none"
                    style={{
                      height: '80px',
                      background:
                        'linear-gradient(0deg, rgb(17, 19, 21) 0%, rgba(17, 19, 21, 0.98) 4.7%, rgba(17, 19, 21, 0.96) 8.9%, rgba(17, 19, 21, 0.93) 12.8%, rgba(17, 19, 21, 0.90) 16.56%, rgba(17, 19, 21, 0.86) 20.37%, rgba(17, 19, 21, 0.82) 24.4%, rgba(17, 19, 21, 0.77) 28.83%, rgba(17, 19, 21, 0.71) 33.84%, rgba(17, 19, 21, 0.65) 39.6%, rgba(17, 19, 21, 0.57) 46.3%, rgba(17, 19, 21, 0.48) 54.1%, rgba(17, 19, 21, 0.38) 63.2%, rgba(17, 19, 21, 0.27) 73.76%, rgba(17, 19, 21, 0.14) 85.97%, rgba(17, 19, 21, 0.00) 100%)',
                    }}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Restore Confirmation Modal */}
      <RestoreConfirmModal
        isOpen={isRestoreModalOpen}
        onClose={() => setIsRestoreModalOpen(false)}
        onConfirm={handleRestoreConfirm}
        commit={selectedCommit}
      />
    </>
  );
}
