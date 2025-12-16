import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';

export interface RenameChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (newName: string) => void;
  currentName: string;
}

export const RenameChatModal = ({ isOpen, onClose, onConfirm, currentName }: RenameChatModalProps) => {
  const [name, setName] = useState<string>(currentName);

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="flex flex-col items-start gap-[12px] border border-[rgba(255,255,255,0.22)] bg-[#111315] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)] w-[500px] p-[32px] rounded-[16px]"
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-[12px] self-stretch">
          <div className="flex flex-col gap-[8px]">
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
              onChange={(e) => setName(e.target.value.slice(0, 50))}
              maxLength={50}
              autoFocus
              className="w-full px-3 py-2 bg-interactive-neutral border border-interactive-neutral rounded text-primary text-body-md placeholder:text-tertiary focus:outline-none focus:border-[rgba(148,250,239,0.5)]"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col items-start gap-[10px] self-stretch">
            <div className="flex justify-end items-center gap-3 self-stretch">
              <CustomButton variant="secondary-ghost" size="lg" type="button" onClick={onClose}>
                Cancel
              </CustomButton>
              <CustomButton variant="primary-filled" size="lg" type="submit" disabled={!name.trim()}>
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
