import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';
import useViewport from '~/lib/hooks';
import { classNames } from '~/utils/classNames';

// Removing HTML tags from input
const sanitizeInput = (input: string) => input.replace(/<[^>]*>/g, '');

export interface RenameChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (newName: string) => void;
  currentName: string;
}

export const RenameChatModal = ({ isOpen, onClose, onConfirm, currentName }: RenameChatModalProps) => {
  const [name, setName] = useState<string>(currentName);
  const isSmallViewport = useViewport(1003);

  // Reset name when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
    }
  }, [isOpen, currentName]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (name.trim()) {
      onConfirm(name.trim());
    }
  };

  return createPortal(
    <div
      className={classNames('fixed inset-0 z-50', {
        'bg-black bg-opacity-50 flex items-center justify-center': !isSmallViewport,
        'bg-[rgba(0,0,0,0.60)] flex items-end': isSmallViewport,
      })}
      onClick={onClose}
    >
      <div
        className={classNames('flex flex-col items-start bg-primary', {
          'gap-3 border border-[rgba(255,255,255,0.22)] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)] w-[500px] p-8 rounded-2xl':
            !isSmallViewport,
          'gap-4 py-7 px-5 w-full rounded-t-2xl rounded-b-none shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)]':
            isSmallViewport,
        })}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-center items-start gap-2 self-stretch">
          <span className="text-primary text-heading-md flex-[1_0_0]">Edit Title</span>
          <button onClick={onClose} className="bg-transparent p-2 justify-center items-center gap-1.5">
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* Input Field */}
        <form
          onSubmit={handleSubmit}
          className={classNames('flex flex-col gap-3 self-stretch', {
            'gap-4': isSmallViewport,
          })}
        >
          <div
            className={classNames('flex flex-col gap-2', {
              'pb-4': isSmallViewport,
            })}
          >
            <div className="flex justify-between items-start self-stretch">
              <label className="flex items-start gap-3 flex-[1_0_0] text-secondary text-body-md-medium">
                Title
                {!name.trim() && <span className="text-danger-bold text-body-md-regular">*</span>}
              </label>
              <div className="flex items-start gap-0.5">
                <span className="text-body-md-medium text-subtle">{name.length}</span>
                <span className="text-body-md-medium text-secondary">/50</span>
              </div>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(sanitizeInput(e.target.value).slice(0, 50))}
              maxLength={50}
              autoFocus
              className="w-full px-3 py-2 bg-interactive-neutral border border-interactive-neutral rounded text-primary text-body-md placeholder:text-tertiary focus:outline-none focus:border-[rgba(148,250,239,0.5)]"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col items-start gap-[10px] self-stretch">
            <div
              className={classNames('flex items-center gap-3 self-stretch', {
                'justify-end': !isSmallViewport,
                'flex-col-reverse': isSmallViewport,
              })}
            >
              <CustomButton
                className={isSmallViewport ? 'w-full' : ''}
                variant="secondary-ghost"
                size="lg"
                type="button"
                onClick={onClose}
              >
                Cancel
              </CustomButton>
              <CustomButton
                className={isSmallViewport ? 'w-full' : ''}
                variant="primary-filled"
                size="lg"
                type="submit"
                disabled={!name.trim()}
              >
                Save
              </CustomButton>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
