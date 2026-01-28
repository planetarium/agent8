import { useState, useEffect } from 'react';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { classNames } from '~/utils/classNames';
import { BaseModal } from '~/components/ui/BaseModal';

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
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  // Reset name when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
    }
  }, [isOpen, currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (name.trim()) {
      onConfirm(name.trim());
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Edit Title">
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

        <BaseModal.Actions gap="gap-2" layout="horizontal">
          <BaseModal.CancelButton onClick={onClose} size="md" />
          <BaseModal.ConfirmButton type="submit" disabled={!name.trim()} size="md">
            Save
          </BaseModal.ConfirmButton>
        </BaseModal.Actions>
      </form>
    </BaseModal>
  );
};
