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
          <span className="text-primary text-body-md-medium">Switch to Old UI</span>
          <span className="text-tertiary text-body-sm">
            If you did not confirm the work you were previously working on, you must confirm it in the old UI. Old UI
            will be removed soon, so please confirm the old tasks.
          </span>
        </div>
        <LegacyUiConfirmModal isOpen={isModalOpen} onClose={handleModalClose} onConfirm={handleConfirm} />
      </>
    );
  }

  return null;
}
