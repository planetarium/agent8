import { BaseModal } from '~/components/ui/BaseModal';
import { RestoreIcon } from '~/components/ui/Icons';

export interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RestoreConfirmModal({ isOpen, onClose, onConfirm }: RestoreConfirmModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Restore this version?">
      <BaseModal.Description>
        This will replace the current project code with this version. Chat history will remain.
      </BaseModal.Description>
      <BaseModal.Actions gap="gap-2" layout="horizontal">
        <BaseModal.CancelButton onClick={onClose} size="md" />
        <BaseModal.ConfirmButton onClick={onConfirm} size="md">
          <RestoreIcon size={20} color="#f3f5f8" />
          Restore
        </BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}
