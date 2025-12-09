import { createPortal } from 'react-dom';
import { CloseIcon, RestoreIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';

export interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RestoreConfirmModal({ isOpen, onClose, onConfirm }: RestoreConfirmModalProps) {
  if (!isOpen) {
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
            Are you sure you want to restore this version?
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
