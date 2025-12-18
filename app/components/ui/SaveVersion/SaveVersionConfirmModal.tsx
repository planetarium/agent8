import { useEffect, useState } from 'react';
import useViewport from '~/lib/hooks/useViewport';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { classNames } from '~/utils/classNames';
import { BaseModal } from '~/components/ui/BaseModal';

export interface SaveVersionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (title: string, description: string) => void;
  commitTitle: string | null;
}

// Removing HTML tags from input
const sanitizeInput = (input: string) => input.replace(/<[^>]*>/g, '');

export function SaveVersionConfirmModal({ isOpen, onClose, onConfirm, commitTitle }: SaveVersionConfirmModalProps) {
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  // Reset fields when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
    }
  }, [isOpen]);

  if (!commitTitle) {
    return null;
  }

  const handleConfirm = () => {
    if (!title.trim()) {
      return;
    }

    onConfirm(title.trim(), description.trim());
  };

  const isFormValid = title.trim().length > 0;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Save to Version History">
      {/* Content */}
      <div
        className={classNames('flex flex-col items-start gap-4 self-stretch', {
          'pb-4': isSmallViewport,
        })}
      >
        <span className="text-body-md-medium text-tertiary self-stretch">
          Save versions to easily compare and restore them
        </span>

        {/* Version Title Input */}
        <div
          className={classNames('flex flex-col items-start gap-2 self-stretch', {
            'gap-3 pt-2': isSmallViewport,
          })}
        >
          <div className="flex justify-between items-start self-stretch">
            <label className="flex items-start gap-1 flex-[1_0_0] text-secondary text-body-md-medium">
              Title
              {!title.trim() && <span className="text-danger-bold text-body-md-regular">*</span>}
            </label>
            <div className="flex items-start gap-0.5">
              <span className="text-body-md-medium text-subtle">{title.length}</span>
              <span className="text-body-md-medium text-secondary">/50</span>
            </div>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(sanitizeInput(e.target.value).slice(0, 50))}
            maxLength={50}
            className="w-full px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-primary text-body-md placeholder:text-tertiary focus:outline-none focus:border-[rgba(148,250,239,0.5)]"
          />
        </div>

        {/* Description Input */}
        <div
          className={classNames('flex flex-col items-start gap-2 self-stretch', {
            'gap-3': isSmallViewport,
          })}
        >
          <label className="text-body-md-medium text-primary">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(sanitizeInput(e.target.value))}
            placeholder="Describe what changed"
            rows={1}
            className="w-full px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-primary text-body-md placeholder:text-tertiary focus:outline-none focus:border-[rgba(148,250,239,0.5)] resize-none"
          />
        </div>
      </div>

      {/* Actions */}
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose} />
        <BaseModal.ConfirmButton onClick={handleConfirm} disabled={!isFormValid}>
          Save
        </BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}
