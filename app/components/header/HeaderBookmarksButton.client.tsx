import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import * as Tooltip from '@radix-ui/react-tooltip';

import { repoStore } from '~/lib/stores/repo';
import { getVersionHistory, deleteVersion, forkProject } from '~/lib/persistenceGitbase/api.client';
import type { VersionEntry } from '~/lib/persistenceGitbase/gitlabService';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';
import { handleChatError } from '~/utils/errorNotification';
import { classNames } from '~/utils/classNames';
import {
  CloseIcon,
  StarLineIcon,
  DeleteIcon,
  RestoreIcon,
  ChevronRightIcon,
  BookmarkLineIcon,
} from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import CustomIconButton from '~/components/ui/CustomIconButton';
import { BaseModal } from '~/components/ui/BaseModal';
import { RestoreConfirmModal } from '~/components/ui/Restore';
import { restoreVersion } from '~/utils/restoreVersion';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';

// Delete Confirmation Modal Component
interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  version: VersionEntry | null;
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, version }: DeleteConfirmModalProps) {
  if (!version) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Remove from bookmarks?">
      <BaseModal.Description>You can add it again anytime</BaseModal.Description>
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose} />
        <BaseModal.DestructiveButton onClick={onConfirm}>Remove</BaseModal.DestructiveButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}

// Fork Confirmation Modal Component
interface ForkConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  version: VersionEntry | null;
}

function ForkConfirmModal({ isOpen, onClose, onConfirm, version }: ForkConfirmModalProps) {
  if (!version) {
    return null;
  }

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Create a copy of this version?">
      <BaseModal.Description>
        This creates a new project from this version. Chat history won&apos;t be copied to the new project.
      </BaseModal.Description>
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose} />
        <BaseModal.ConfirmButton onClick={onConfirm}>Create copy</BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}

interface HeaderBookmarksButtonProps {
  asMenuItem?: boolean;
  onClose?: () => void;
}

export function HeaderBookmarksButton({ asMenuItem = false, onClose }: HeaderBookmarksButtonProps) {
  const repo = useStore(repoStore);
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [allVersions, setAllVersions] = useState<VersionEntry[]>([]); // All versions fetched
  const [displayedVersions, setDisplayedVersions] = useState<VersionEntry[]>([]); // Currently displayed
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showGradient, setShowGradient] = useState<boolean>(true);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState<boolean>(false);
  const [selectedVersionForRestore, setSelectedVersionForRestore] = useState<VersionEntry | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [selectedVersionForDelete, setSelectedVersionForDelete] = useState<VersionEntry | null>(null);
  const [isForkModalOpen, setIsForkModalOpen] = useState<boolean>(false);
  const [selectedVersionForFork, setSelectedVersionForFork] = useState<VersionEntry | null>(null);

  const VERSIONS_PER_PAGE = 20;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);

    if (open) {
      setShowGradient(true); // Reset gradient visibility when opening
    } else {
      onClose?.();
    }
  };

  // Fetch versions when modal opens
  useEffect(() => {
    if (isOpen && repo.path) {
      fetchVersions();
    }
  }, [isOpen, repo.path]);

  const fetchVersions = async () => {
    if (!repo.path) {
      return;
    }

    setLoading(true);

    try {
      const versionList = await getVersionHistory(repo.path);
      setAllVersions(versionList);

      // Display first page
      setDisplayedVersions(versionList.slice(0, VERSIONS_PER_PAGE));
      setCurrentPage(1);
    } catch (error) {
      console.error('Failed to fetch version history:', error);
      toast.error('Failed to load version history');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (loadingMore) {
      return;
    }

    setLoadingMore(true);

    const nextPage = currentPage + 1;
    const startIndex = 0;
    const endIndex = nextPage * VERSIONS_PER_PAGE;
    const newDisplayed = allVersions.slice(startIndex, endIndex);

    setDisplayedVersions(newDisplayed);
    setCurrentPage(nextPage);
    setLoadingMore(false);
  };

  const hasMore = displayedVersions.length < allVersions.length;

  // Open restore confirmation modal
  const handleRestoreClick = (version: VersionEntry) => {
    setSelectedVersionForRestore(version);
    setIsRestoreModalOpen(true);
  };

  // Actual restore logic after confirmation
  const handleRestoreConfirm = async () => {
    if (!selectedVersionForRestore) {
      return;
    }

    // Close modals immediately to prevent duplicate clicks
    const versionToRestore = selectedVersionForRestore;
    setIsRestoreModalOpen(false);
    setIsOpen(false);

    await restoreVersion({
      projectPath: repo.path,
      commitHash: versionToRestore.commitHash,
      commitTitle: versionToRestore.commitTitle,
    });
  };

  // Open delete confirmation modal
  const handleDeleteClick = (version: VersionEntry) => {
    setSelectedVersionForDelete(version);
    setIsDeleteModalOpen(true);
  };

  // Actual delete logic after confirmation
  const handleDeleteConfirm = async () => {
    if (!repo.path || !selectedVersionForDelete) {
      return;
    }

    // Close modal first
    setIsDeleteModalOpen(false);

    // Show loading toast
    const toastId = toast.loading('Deleting version...');

    try {
      await deleteVersion(repo.path, selectedVersionForDelete.commitHash);

      // Trigger version delete event
      const { triggerVersionDelete } = await import('~/lib/stores/versionEvent');
      triggerVersionDelete(selectedVersionForDelete.commitHash);

      // Update local state
      const updatedAll = allVersions.filter((v) => v.commitHash !== selectedVersionForDelete.commitHash);
      const updatedDisplayed = displayedVersions.filter((v) => v.commitHash !== selectedVersionForDelete.commitHash);

      setAllVersions(updatedAll);
      setDisplayedVersions(updatedDisplayed);

      // Dismiss loading toast and show success
      toast.dismiss(toastId);
      toast.success('Version deleted successfully');
    } catch (error) {
      // Dismiss loading toast and show error
      toast.dismiss(toastId);
      console.error('Failed to delete version:', error);
      toast.error('Failed to delete version');
    }
  };

  // Open fork confirmation modal
  const handleForkClick = (version: VersionEntry) => {
    setSelectedVersionForFork(version);
    setIsForkModalOpen(true);
  };

  // Actual fork logic after confirmation
  const handleForkConfirm = async () => {
    if (!selectedVersionForFork) {
      return;
    }

    const commitHash = selectedVersionForFork.commitHash;

    if (!commitHash || !isCommitHash(commitHash)) {
      handleChatError('No commit hash found', {
        context: 'handleFork - commit hash validation',
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
    const toastId = toast.loading('Creating a copy...');

    try {
      const forkedProject = await forkProject(repo.path, newRepoName, commitHash, repo.title, {
        resetEnv: true,
      });

      // Dismiss the loading toast
      toast.dismiss(toastId);

      if (forkedProject && forkedProject.success) {
        toast.success('Copy created — now in your copy.');
        window.location.href = '/chat/' + forkedProject.project.path;
      } else {
        handleChatError('Failed to create copy', {
          context: 'handleFork - fork result check',
        });
      }
    } catch (error) {
      // Dismiss the loading toast and show error
      toast.dismiss(toastId);

      handleChatError('Failed to create copy', {
        error: error instanceof Error ? error : String(error),
        context: 'handleFork - catch block',
      });
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
          <BookmarkLineIcon width={20} height={20} />
          <span>Bookmarks</span>
        </div>
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <CustomButton variant="secondary-outlined" size="md" onClick={() => handleOpenChange(true)}>
              <StarLineIcon size={20} />
              Bookmarks
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
              View versions to compare or restore
              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-38px]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}

      {isOpen &&
        createPortal(
          <div
            className={`fixed inset-0 flex items-center justify-center z-50 ${isSmallViewport ? 'bg-primary' : 'bg-[rgba(0,0,0,0.60)] backdrop-blur-[4px]'}`}
            onClick={() => handleOpenChange(false)}
          >
            <div
              className={`overflow-hidden flex flex-col items-start bg-primary gap-3 ${
                isSmallViewport
                  ? 'w-full h-full px-4'
                  : 'max-w-[615px] w-full border border-secondary rounded-2xl elevation-light-3 p-8'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              {!isSmallViewport ? (
                <header className="flex items-center gap-2 self-stretch">
                  <h1 className="text-heading-md text-primary flex-[1_0_0]">Bookmarks</h1>
                  <button
                    onClick={() => handleOpenChange(false)}
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
                    onClick={() => handleOpenChange(false)}
                  />
                  <h1 className="text-heading-xs text-primary flex-[1_0_0]">Bookmarks</h1>
                </div>
              )}

              <div className="flex flex-col items-start gap-1 self-stretch">
                <span className="text-heading-2xs text-tertiary">
                  <span className="text-secondary">Create a Copy</span> creates a new project from the selected version.
                  Chat history won&apos;t be copied to the new project.
                </span>
                <span className="text-heading-2xs text-tertiary">
                  <span className="text-secondary">Restore</span> reverts the current project to the selected version.
                  Changes after that version may be lost, but your chat history will remain.
                </span>
              </div>

              {/* Content */}
              <div className={`relative self-stretch ${isSmallViewport ? 'flex-[1_0_0] overflow-hidden min-h-0' : ''}`}>
                <div
                  className={`flex flex-col items-start gap-3 overflow-y-auto self-stretch ${isSmallViewport ? 'h-full' : 'h-[600px]'}`}
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
                  }}
                  onScroll={handleScroll}
                >
                  {loading && displayedVersions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full w-full">
                      <div className="animate-spin rounded-full h-10 w-10 border-2 border-zinc-600 border-t-zinc-400 mb-4" />
                      <div className="text-zinc-400 text-sm">Loading versions...</div>
                    </div>
                  ) : displayedVersions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full w-full">
                      <StarLineIcon size={48} fill="rgba(255, 255, 255, 0.3)" />
                      <div className="text-zinc-400 text-lg font-medium mb-2 mt-4">No saved versions</div>
                    </div>
                  ) : (
                    <>
                      {displayedVersions.map((version, index) => (
                        <div
                          key={`${version.commitHash}-${index}`}
                          className="flex flex-col justify-center items-start gap-3 p-3 self-stretch rounded-lg border border-interactive-neutral bg-primary"
                        >
                          <div className="flex items-start gap-2 self-stretch">
                            <div className="flex flex-col items-start gap-2 flex-[1_0_0]">
                              {/* Title */}
                              <div className="flex items-center gap-2 self-stretch">
                                <span className="text-body-sm text-tertiary flex-[1_0_0] self-stretch line-clamp-1 overflow-hidden text-ellipsis">
                                  {version.title}
                                </span>
                              </div>

                              {/* Commit Message (if different from title) */}
                              {version.title && (
                                <span className="w-[295px] h-5 text-body-md-medium text-secondary overflow-hidden line-clamp-1 text-ellipsis">
                                  {version.commitTitle}
                                </span>
                              )}
                            </div>

                            <CustomIconButton
                              variant="secondary-transparent"
                              onClick={() => handleDeleteClick(version)}
                              icon={<DeleteIcon size={20} />}
                              size="sm"
                            />
                          </div>

                          {/* Description */}
                          {version.description && (
                            <span className="text-body-sm text-tertiary line-clamp-1 self-stretch">
                              {version.description}
                            </span>
                          )}

                          {/* Actions */}
                          <div
                            className={classNames('flex items-start self-stretch', {
                              'gap-2': isSmallViewport,
                              'justify-end gap-2': !isSmallViewport,
                            })}
                          >
                            <CustomButton
                              className={isSmallViewport ? 'flex-[1_0_0]' : ''}
                              variant="secondary-ghost"
                              size="md"
                              onClick={() => handleForkClick(version)}
                            >
                              <span>Create a Copy</span>
                            </CustomButton>
                            <CustomButton
                              className={isSmallViewport ? 'flex-[1_0_0]' : ''}
                              variant="secondary-ghost"
                              size="md"
                              onClick={() => handleRestoreClick(version)}
                              disabled={version.commitHash === repo.latestCommitHash}
                            >
                              <RestoreIcon size={20} />
                              <span className="text-interactive-primary">Restore</span>
                            </CustomButton>
                          </div>
                        </div>
                      ))}

                      {/* Load More Button */}
                      {(hasMore || displayedVersions.length > 0) && (
                        <div className="flex justify-center py-6 w-full">
                          <CustomButton
                            variant="secondary-ghost"
                            size="md"
                            onClick={handleLoadMore}
                            disabled={loadingMore || !hasMore}
                          >
                            {loadingMore ? (
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
                          </CustomButton>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Gradient overlay when there are 5+ versions and not scrolled to bottom */}
                {displayedVersions.length >= 5 && showGradient && (
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
        version={selectedVersionForFork}
      />

      {/* Restore Confirmation Modal */}
      <RestoreConfirmModal
        isOpen={isRestoreModalOpen}
        onClose={() => setIsRestoreModalOpen(false)}
        onConfirm={handleRestoreConfirm}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        version={selectedVersionForDelete}
      />
    </>
  );
}
