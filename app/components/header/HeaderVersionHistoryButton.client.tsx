import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import * as Tooltip from '@radix-ui/react-tooltip';

import { repoStore } from '~/lib/stores/repo';
import { getVersionHistory, deleteVersion } from '~/lib/persistenceGitbase/api.client';
import type { VersionEntry } from '~/lib/persistenceGitbase/gitlabService';
import { CloseIcon, StarLineIcon, DeleteIcon, RestoreIcon, ChevronRightIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import CustomIconButton from '~/components/ui/CustomIconButton';
import { RestoreConfirmModal } from '~/components/ui/Restore';
import { restoreVersion } from '~/utils/restoreVersion';
import useViewport from '~/lib/hooks';
import { classNames } from '~/utils/classNames';

// Delete Confirmation Modal Component
interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  version: VersionEntry | null;
  isSmallViewport?: boolean;
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, version, isSmallViewport }: DeleteConfirmModalProps) {
  if (!isOpen || !version) {
    return null;
  }

  return createPortal(
    <div
      className={classNames('fixed inset-0 z-50', {
        'bg-black bg-opacity-50 flex items-center justify-center': !isSmallViewport,
        'bg-[rgba(0,0,0,0.60)] flex items-end': !!isSmallViewport,
      })}
      onClick={onClose}
    >
      <div
        className={classNames('flex flex-col items-start bg-primary', {
          'gap-3 border border-[rgba(255,255,255,0.22)] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)] w-[500px] p-8 rounded-2xl':
            !isSmallViewport,
          'gap-4 py-7 px-5 w-full rounded-t-2xl rounded-b-none shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)]':
            !!isSmallViewport,
        })}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 self-stretch">
          <span className="text-primary text-heading-md flex-[1_0_0]">
            Are you sure you want to delete this version?
          </span>
          <button onClick={onClose} className="bg-transparent p-2 justify-center items-center gap-1.5">
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-start gap-[10px] self-stretch">
          <div
            className={classNames('flex items-center gap-3 self-stretch', {
              'justify-end': !isSmallViewport,
              'flex-col-reverse': !!isSmallViewport,
            })}
          >
            <CustomButton
              className={isSmallViewport ? 'w-full' : ''}
              variant="secondary-ghost"
              size="lg"
              onClick={onClose}
            >
              Cancel
            </CustomButton>
            <CustomButton
              className={isSmallViewport ? 'w-full' : ''}
              variant="destructive-filled"
              size="lg"
              onClick={onConfirm}
            >
              Delete
            </CustomButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface HeaderVersionHistoryButtonProps {
  asMenuItem?: boolean;
  onClose?: () => void;
}

export function HeaderVersionHistoryButton({ asMenuItem = false, onClose }: HeaderVersionHistoryButtonProps) {
  const repo = useStore(repoStore);
  const isSmallViewport = useViewport(1003);
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

    await restoreVersion({
      projectPath: repo.path,
      commitHash: selectedVersionForRestore.commitHash,
      commitTitle: selectedVersionForRestore.commitTitle,
      onSuccess: () => {
        setIsRestoreModalOpen(false);
        setIsOpen(false);
      },
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
          <StarLineIcon size={20} />
          <span>Version History</span>
        </div>
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <CustomButton variant="secondary-text" size="md" onClick={() => handleOpenChange(true)}>
              <StarLineIcon size={20} />
              Version History
            </CustomButton>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-lg-medium"
              sideOffset={5}
              side="bottom"
              align="end"
              alignOffset={0}
            >
              View versions to compare or restore
              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-45px]" />
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
                  : 'max-w-[800px] w-full border border-secondary rounded-2xl elevation-light-3 p-8'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              {!isSmallViewport ? (
                <header className="flex items-center gap-2 self-stretch">
                  <h1 className="text-heading-md text-primary flex-[1_0_0]">Version History</h1>
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
                  <h1 className="text-heading-xs text-primary flex-[1_0_0]">Version History</h1>
                </div>
              )}

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
                                <span className="w-[295px] h-5 text-heading-xs text-primary overflow-hidden line-clamp-1 text-ellipsis">
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
                          <div className="flex justify-end items-start gap-2 self-stretch">
                            {isSmallViewport && <div className="flex-[1_0_0]" />}
                            <CustomButton
                              className={isSmallViewport ? 'flex-[1_0_0]' : ''}
                              variant="secondary-ghost"
                              size="md"
                              onClick={() => handleRestoreClick(version)}
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
        isSmallViewport={isSmallViewport}
      />
    </>
  );
}
