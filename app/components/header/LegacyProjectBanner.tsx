import { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { repoStore } from '~/lib/stores/repo';
import { WarningLinedIcon, ExternalLinkIcon, CloseIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import CustomIconButton from '~/components/ui/CustomIconButton';
import { LegacyUiConfirmModal } from '~/components/ui/LegacyUi';
import { sendMessageToParent } from '~/utils/postMessage';

interface LegacyProjectBannerProps {
  chatStarted: boolean;
}

export function LegacyProjectBanner({ chatStarted }: LegacyProjectBannerProps) {
  const repo = useStore(repoStore);
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);
  const [isLegacyModalOpen, setIsLegacyModalOpen] = useState<boolean>(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState<boolean>(true);

  /*
   * Check if project is legacy (created before the cutoff date)
   * Default: KST 2026-01-19 14:00 = UTC 2026-01-19 05:00
   */
  const cutoffDateString = import.meta.env.VITE_LEGACY_PROJECT_CUTOFF_DATE || '2026-01-19T05:00:00Z';
  const LEGACY_CUTOFF_DATE = new Date(cutoffDateString);
  const isLegacyProject = repo.createdAt && new Date(repo.createdAt) < LEGACY_CUTOFF_DATE;

  // Check if banner has been dismissed for this project
  useEffect(() => {
    if (repo.path) {
      const dismissed = localStorage.getItem(`legacy-banner-dismissed-${repo.path}`);
      setIsBannerDismissed(dismissed === 'true');
    }
  }, [repo.path]);

  if (!chatStarted || !isLegacyProject || isSmallViewport || isBannerDismissed) {
    return null;
  }

  const handleSwitchToLegacyClick = () => {
    setIsLegacyModalOpen(true);
  };

  const handleLegacyModalClose = () => {
    setIsLegacyModalOpen(false);
  };

  const handleLegacyConfirm = () => {
    // Mark banner as dismissed for this project
    if (repo.path) {
      localStorage.setItem(`legacy-banner-dismissed-${repo.path}`, 'true');
    }

    // Send message to parent to switch to legacy UI
    sendMessageToParent({ type: 'SWITCH_TO_LEGACY_UI' });
    setIsLegacyModalOpen(false);
  };

  const handleBannerClose = () => {
    // Mark banner as dismissed for this project
    if (repo.path) {
      localStorage.setItem(`legacy-banner-dismissed-${repo.path}`, 'true');
      setIsBannerDismissed(true);
    }
  };

  return (
    <div
      className="fixed left-0 right-0 z-9 flex h-[60px] items-center gap-3 py-2 px-10 backdrop-blur-[6px]"
      style={{
        top: 'var(--header-height)',
        background: 'var(--color-bg-interactive-warning-subtle, rgba(247, 144, 9, 0.20))',
      }}
    >
      <div className="flex flex-col items-start gap-1.5 flex-[1_0_0]">
        <div className="flex items-center gap-2 self-stretch">
          <WarningLinedIcon size={20} />
          <span className="text-heading-xs text-accent-orange">
            Missing your work? Merge your tasks from the old version
          </span>
        </div>
        <span className="text-body-sm text-secondary">
          If you did not merge the work you were previously working on, you must merge it in the old UI.
        </span>
      </div>
      <div className="flex justify-end items-center gap-2">
        <CustomButton variant="secondary-ghost" size="md">
          <span className="text-heading-xs text-interactive-neutral">Learn more</span>
          <ExternalLinkIcon size={20} />
        </CustomButton>
        <CustomButton variant="primary-ghost" size="md" onClick={handleSwitchToLegacyClick}>
          <span className="text-heading-xs text-interactive-primary">Switch to Old UI</span>
        </CustomButton>
      </div>
      <CustomIconButton
        variant="secondary-transparent"
        size="md"
        icon={<CloseIcon width={24} height={24} />}
        onClick={handleBannerClose}
      />

      {/* Legacy UI Confirm Modal */}
      <LegacyUiConfirmModal
        isOpen={isLegacyModalOpen}
        onClose={handleLegacyModalClose}
        onConfirm={handleLegacyConfirm}
      />
    </div>
  );
}
