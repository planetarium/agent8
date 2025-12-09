import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';

import { repoStore } from '~/lib/stores/repo';
import { getVersionHistory, deleteVersion } from '~/lib/persistenceGitbase/api.client';
import type { VersionEntry } from '~/lib/persistenceGitbase/gitlabService';
import { CloseIcon, StarLineIcon, DeleteIcon, RestoreIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import CustomIconButton from '~/components/ui/CustomIconButton';
import { RestoreConfirmModal } from '~/components/ui/Restore';
import { restoreVersion } from '~/utils/restoreVersion';

// Delete Confirmation Modal Component
interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  version: VersionEntry | null;
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, version }: DeleteConfirmModalProps) {
  if (!isOpen || !version) {
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
            Are you sure you want to delete this version?
          </span>
          <button onClick={onClose} className="bg-transparent p-2 justify-center items-center gap-1.5">
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-start gap-[10px] self-stretch">
          <div className="flex justify-end items-center gap-3 self-stretch">
            <CustomButton variant="secondary-ghost" size="lg" onClick={onClose}>
              Cancel
            </CustomButton>
            <CustomButton variant="destructive-filled" size="lg" onClick={onConfirm}>
              Delete
            </CustomButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function HeaderVersionHistoryButton() {
  const repo = useStore(repoStore);
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
      <CustomButton variant="secondary-text" size="md" onClick={() => handleOpenChange(true)}>
        <StarLineIcon size={20} />
        Version History
      </CustomButton>

      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 bg-[rgba(0, 0, 0, 0.60)] backdrop-blur-[4px] flex items-center justify-center z-50"
            onClick={() => handleOpenChange(false)}
          >
            <div
              className="max-w-[800px] w-full overflow-hidden flex flex-col items-start bg-primary border border-secondary rounded-2xl elevation-light-3 gap-3 p-8"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <header className="flex items-center gap-2 self-stretch">
                <h1 className="text-heading-md text-primary flex-[1_0_0]">Version History</h1>
                <button
                  onClick={() => handleOpenChange(false)}
                  className="flex p-2 justify-center items-center gap-1.5 bg-transparent"
                >
                  <CloseIcon width={20} height={20} />
                </button>
              </header>

              {/* Content */}
              <div className="relative flex-[1_0_0] self-stretch">
                <div
                  className="flex flex-col h-[600px] items-start gap-3 overflow-y-auto self-stretch"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
                  }}
                  onScroll={handleScroll}
                >
                  {loading && displayedVersions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full w-full">
                      <div className="animate-spin rounded-full h-10 w-10 border-2 border-zinc-600 border-t-zinc-400 mb-4"></div>
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
                            <CustomButton
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
      />
    </>
  );
}
