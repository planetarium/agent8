import { useState } from 'react';
import { LegacyUiConfirmModal } from '~/components/ui/LegacyUi';
import { sendMessageToParent } from '~/utils/postMessage';

interface HeaderLegacyUiToggleProps {
  asMenuItem?: boolean;
  onClose?: () => void;
}

export function HeaderLegacyUiToggle({ asMenuItem = false, onClose }: HeaderLegacyUiToggleProps) {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const handleClick = () => {
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    onClose?.(); // Close dropdown when modal closes
  };

  const handleConfirm = () => {
    // Send message to parent to switch to legacy UI
    sendMessageToParent({ type: 'SWITCH_TO_LEGACY_UI' });
    setIsModalOpen(false);
    onClose?.();
  };

  if (asMenuItem) {
    return (
      <>
        <div className="flex flex-col items-start gap-2 w-full bg-transparent cursor-pointer" onClick={handleClick}>
          <span className="text-primary text-body-md-medium">Switch to previous UI</span>
          <span className="text-tertiary text-body-sm">
            If you need to review branches you worked on through Tasks, you&apos;ll have to use the previous UI. This
            feature will be removed soon and replaced with the Save Version feature in the new UI.
          </span>
        </div>
        <LegacyUiConfirmModal isOpen={isModalOpen} onClose={handleModalClose} onConfirm={handleConfirm} />
      </>
    );
  }

  return null;
}
