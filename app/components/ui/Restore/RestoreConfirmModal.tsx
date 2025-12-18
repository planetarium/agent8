import { BaseModal } from '~/components/ui/BaseModal';
import { RestoreIcon } from '~/components/ui/Icons';

export interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RestoreConfirmModal({ isOpen, onClose, onConfirm }: RestoreConfirmModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Are you sure you want to restore this version?">
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose} />
        <BaseModal.ConfirmButton onClick={onConfirm}>
          <RestoreIcon size={24} color="#f3f5f8" />
          Restore
        </BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}
