import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import * as Tooltip from '@radix-ui/react-tooltip';

import { repoStore } from '~/lib/stores/repo';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { forkProject, fetchProjectFiles, setRestorePoint } from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { handleChatError } from '~/utils/errorNotification';
import { getElapsedTime } from '~/utils/performance';
import { classNames } from '~/utils/classNames';
import { workbenchStore } from '~/lib/stores/workbench';
import { convertFileMapToFileSystemTree } from '~/utils/fileUtils';
import { triggerRestoreEvent } from '~/lib/stores/restore';
import { V8_ACCESS_TOKEN_KEY } from '~/lib/verse8/userAuth';

import { Button } from '~/components/ui/Button';
import CustomIconButton from '~/components/ui/CustomIconButton';
import CustomButton from '~/components/ui/CustomButton';
import { BaseModal } from '~/components/ui/BaseModal';
import { HistoryIcon, CloseIcon, OutLinkIcon, ForkIcon, RestoreIcon, ChevronRightIcon } from '~/components/ui/Icons';

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
  if (!commit) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Are you sure you want to restore this commit?">
      <div className="flex flex-col items-start pb-4 gap-4 self-stretch">
        <span className="text-body-md-medium text-tertiary self-stretch">
          Changes will be applied to this project. Publishing will update the existing project.
        </span>
      </div>
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose} />
        <BaseModal.ConfirmButton onClick={onConfirm}>
          <RestoreIcon size={24} color="#f3f5f8" />
          Restore
        </BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}

// Fork Confirmation Modal Component
interface ForkConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  commit: Commit | null;
}

function ForkConfirmModal({ isOpen, onClose, onConfirm, commit }: ForkConfirmModalProps) {
  if (!commit) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Are you sure you want to fork this commit?">
      <div className="flex flex-col items-start pb-4 gap-4 self-stretch">
        <span className="text-body-md-medium text-tertiary self-stretch">
          A new project will be created. Publishing will produce a separate project from the original.
        </span>
      </div>
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose} />
        <BaseModal.ConfirmButton onClick={onConfirm}>
          <ForkIcon size={24} fill="#f3f5f8" />
          Fork
        </BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}

interface HeaderCommitHistoryButtonProps {
  asMenuItem?: boolean;
  onClose?: () => void;
}

export function HeaderCommitHistoryButton({ asMenuItem = false, onClose }: HeaderCommitHistoryButtonProps) {
  const repo = useStore(repoStore);
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [showGradient, setShowGradient] = useState<boolean>(true);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState<boolean>(false);
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
  const [isForkModalOpen, setIsForkModalOpen] = useState<boolean>(false);
  const [selectedCommitForFork, setSelectedCommitForFork] = useState<Commit | null>(null);

  const COMMITS_PER_PAGE = 50;

  const fetchCommits = async (page: number = 1, append: boolean = false) => {
    if (!repo.path) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        projectPath: repo.path,
        page: page.toString(),
        perPage: COMMITS_PER_PAGE.toString(),
      });

      const response = await fetch(`/api/gitlab/commits?${params}`);
      const data: CommitResponse = await response.json();

      if (data.success && data.data) {
        const filteredCommits = data.data.commits.filter((commit) => !commit.message.startsWith('Merge branch'));

        if (append) {
          setCommits((prev) => [...prev, ...filteredCommits]);
        } else {
          setCommits(filteredCommits);
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
    } else {
      onClose?.();
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

  // Open fork confirmation modal
  const handleForkClick = (commit: Commit) => {
    setSelectedCommitForFork(commit);
    setIsForkModalOpen(true);
  };

  // Actual fork logic after confirmation
  const handleForkConfirm = async () => {
    if (!selectedCommitForFork) {
      return;
    }

    const startTime = performance.now();
    const commitHash = selectedCommitForFork.id;
    const commitInfo = selectedCommitForFork.title || selectedCommitForFork.message.split('\n')[0];

    if (!commitHash || !isCommitHash(commitHash)) {
      handleChatError('No commit hash found', {
        context: 'handleFork - commit hash validation',
        prompt: commitInfo || undefined,
        elapsedTime: getElapsedTime(startTime),
      });

      setIsForkModalOpen(false);

      return;
    }

    const nameWords = repo.name.split('-');

    let newRepoName = '';

    if (nameWords && Number.isInteger(Number(nameWords[nameWords.length - 1]))) {
      newRepoName = nameWords.slice(0, -1).join('-');
    } else {
      newRepoName = nameWords.join('-');
    }

    // Close modal first
    setIsForkModalOpen(false);

    // Show loading toast while forking
    const toastId = toast.loading('Forking project...');

    try {
      const forkedProject = await forkProject(repo.path, newRepoName, commitHash, repo.title, {
        resetEnv: true,
      });

      // Dismiss the loading toast
      toast.dismiss(toastId);

      if (forkedProject && forkedProject.success) {
        toast.success('Fork created — now in your copy.');
        window.location.href = '/chat/' + forkedProject.project.path;
      } else {
        handleChatError('Failed to fork project', {
          context: 'handleFork - fork result check',
          prompt: commitInfo || undefined,
          elapsedTime: getElapsedTime(startTime),
        });
      }
    } catch (error) {
      // Dismiss the loading toast and show error
      toast.dismiss(toastId);

      handleChatError('Failed to fork project', {
        error: error instanceof Error ? error : String(error),
        context: 'handleFork - catch block',
        prompt: commitInfo || undefined,
        elapsedTime: getElapsedTime(startTime),
      });
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

    // Close modals immediately to prevent duplicate clicks
    const commitToRestore = selectedCommit;
    setIsRestoreModalOpen(false);
    setIsOpen(false);

    const startTime = performance.now();
    const commitHash = commitToRestore.id;
    const commitInfo = commitToRestore.title || commitToRestore.message.split('\n')[0];

    if (!commitHash || !isCommitHash(commitHash)) {
      handleChatError('No commit hash found', {
        context: 'handleRestore - commit hash validation',
        prompt: commitInfo || undefined,
        elapsedTime: getElapsedTime(startTime),
      });
      return;
    }

    const toastId = toast.loading('Restoring project...');

    try {
      // Fetch files from the specific commit
      const files = await fetchProjectFiles(repo.path, commitHash);

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found in commit');
      }

      // Reinitialize container to restart terminal
      const accessToken = localStorage.getItem(V8_ACCESS_TOKEN_KEY) || '';
      await workbenchStore.reinitializeContainer(accessToken);

      // Get container instance after reinitialization
      const containerInstance = await workbenchStore.container;

      // Remove existing directories to ensure clean state
      try {
        await containerInstance.fs.rm('/src', { recursive: true, force: true });
        await containerInstance.fs.rm('/PROJECT', { recursive: true, force: true });
      } catch {
        // Ignore error if directories don't exist
      }

      // Mount the files from the commit
      await containerInstance.mount(convertFileMapToFileSystemTree(files));
      workbenchStore.resetAllFileModifications();

      // Run preview to start dev server with restored files
      await workbenchStore.runPreview();

      // Save restore point to GitLab
      try {
        await setRestorePoint(repo.path, commitHash, commitToRestore.title);
      } catch (err) {
        console.warn('Failed to save restore point to GitLab:', err);

        // Continue even if saving fails
      }

      // Update URL with revertTo parameter to ensure commits are based on this version
      window.history.replaceState(null, '', `/chat/${repo.path}?revertTo=${commitHash}`);

      // Trigger restore event to add message to chat
      triggerRestoreEvent(commitHash, commitToRestore.title);

      toast.dismiss(toastId);
      toast.success('Project restored successfully');
    } catch (error) {
      toast.dismiss(toastId);
      handleChatError('Failed to restore project', {
        error: error instanceof Error ? error : String(error),
        context: 'handleRestore - restore process',
        prompt: commitInfo || undefined,
        elapsedTime: getElapsedTime(startTime),
      });
    }
  };

  if (!repo.path) {
    return null;
  }

  return (
    <>
      {asMenuItem ? (
        <div
          className="flex items-center gap-4 w-full bg-transparent text-primary text-body-md-medium cursor-pointer"
          onClick={() => handleOpenChange(true)}
        >
          <HistoryIcon width={20} height={20} />
          <span>Commit History (Gitlab)</span>
        </div>
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <CustomButton variant="secondary-outlined" size="md" onClick={() => handleOpenChange(true)}>
              <HistoryIcon width={20} height={20} />
              Commits
            </CustomButton>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
              sideOffset={5}
              side="bottom"
              align="end"
              alignOffset={0}
            >
              View commits to fork or restore
              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-40px]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}

      {isOpen &&
        createPortal(
          <div
            className={`fixed inset-0 flex items-center justify-center z-50 ${isSmallViewport ? 'bg-primary' : 'bg-[rgba(0,0,0,0.60)] backdrop-blur-[4px]'}`}
            onClick={() => setIsOpen(false)}
          >
            <div
              className={`overflow-hidden flex flex-col items-start bg-primary gap-3 ${
                isSmallViewport
                  ? 'w-full h-full px-4'
                  : 'max-w-[800px] w-full border border-secondary rounded-2xl elevation-light-3 p-8'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {!isSmallViewport ? (
                <header className="flex items-cennter gap-2 self-stretch">
                  <h1 className="text-heading-md text-primary flex-[1_0_0]">Commit History</h1>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="flex p-2 justify-center items-center gap-1.5 bg-transparent"
                  >
                    <CloseIcon width={20} height={20} />
                  </button>
                </header>
              ) : (
                <div className="flex items-center justify-center gap-[10px] pt-3 pb-1 self-stretch">
                  <CustomIconButton
                    variant="secondary-transparent"
                    size="md"
                    icon={<ChevronRightIcon className="rotate-180" width={20} height={20} />}
                    onClick={() => setIsOpen(false)}
                  />
                  <h1 className="text-heading-xs text-primary flex-[1_0_0]">Commit History</h1>
                </div>
              )}

              <div className={`relative self-stretch ${isSmallViewport ? 'flex-[1_0_0] overflow-hidden min-h-0' : ''}`}>
                <div
                  className={`flex flex-col items-start gap-3 overflow-y-auto self-stretch ${isSmallViewport ? 'h-full' : 'h-[600px]'}`}
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
                          <div
                            className={classNames('flex gap-2 self-stretch', {
                              'items-center': !isSmallViewport,
                              'items-start': isSmallViewport,
                            })}
                          >
                            {isSmallViewport ? (
                              <>
                                <div className="flex flex-col items-start gap-2 flex-[1_0_0]">
                                  <span className="text-heading-sm text-primary self-stretch">
                                    {commit.title || commit.message.split('\n')[0]}
                                  </span>
                                  <span
                                    className={classNames('text-tertiary', {
                                      'text-body-sm': isSmallViewport,
                                      'text-body-md-medium': !isSmallViewport,
                                    })}
                                  >
                                    {formatDate(commit.committed_date)}
                                  </span>
                                </div>
                                <CustomIconButton
                                  variant="secondary-transparent"
                                  size="sm"
                                  icon={<OutLinkIcon size={20} />}
                                  onClick={() => window.open(getGitlabCommitUrl(commit.id), '_blank')}
                                />
                              </>
                            ) : (
                              <span className="text-heading-sm text-primary flex-[1_0_0] line-clamp-1 overflow-hidden text-ellipsis">
                                {commit.title || commit.message.split('\n')[0]}
                              </span>
                            )}
                          </div>
                          <div
                            className={classNames('flex items-center self-stretch', {
                              'justify-between': !isSmallViewport,
                              'justify-center': isSmallViewport,
                            })}
                          >
                            {!isSmallViewport && (
                              <span className="text-body-md-medium text-tertiary">
                                {formatDate(commit.committed_date)}
                              </span>
                            )}
                            <div
                              className={classNames('flex items-center gap-3', {
                                'self-stretch': !isSmallViewport,
                                'flex-[1_0_0]': isSmallViewport,
                              })}
                            >
                              {!isSmallViewport && (
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
                              )}
                              <CustomButton
                                className={isSmallViewport ? 'flex-[1_0_0]' : ''}
                                variant="secondary-ghost"
                                size="md"
                                onClick={() => handleForkClick(commit)}
                              >
                                <ForkIcon size={20} />
                                <span>Fork</span>
                              </CustomButton>
                              <CustomButton
                                className={isSmallViewport ? 'flex-[1_0_0]' : ''}
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

      {/* Fork Confirmation Modal */}
      <ForkConfirmModal
        isOpen={isForkModalOpen}
        onClose={() => setIsForkModalOpen(false)}
        onConfirm={handleForkConfirm}
        commit={selectedCommitForFork}
      />

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
