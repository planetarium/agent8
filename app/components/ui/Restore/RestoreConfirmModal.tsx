import { createPortal } from 'react-dom';
import { CloseIcon, RestoreIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { classNames } from '~/utils/classNames';

export interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RestoreConfirmModal({ isOpen, onClose, onConfirm }: RestoreConfirmModalProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  if (!isOpen) {
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
            Are you sure you want to restore this version?
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
              variant="primary-filled"
              size="lg"
              onClick={onConfirm}
            >
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
