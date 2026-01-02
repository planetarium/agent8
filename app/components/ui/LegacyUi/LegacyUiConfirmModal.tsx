import { BaseModal } from '~/components/ui/BaseModal';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { classNames } from '~/utils/classNames';

export interface LegacyUiConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function LegacyUiConfirmModal({ isOpen, onClose, onConfirm }: LegacyUiConfirmModalProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Switch to the previous Agent8 UI?">
      <div
        className={classNames('flex flex-col items-start gap-4 self-stretch', {
          'pb-4': isSmallViewport,
        })}
      >
        <span className="text-body-md-medium text-tertiary self-stretch">
          If you need to review branches you worked on through Tasks, you&apos;ll have to use the previous UI. This
          feature will be removed soon and replaced with the Save Version feature in the new UI.
        </span>
      </div>
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose}>Stay on current UI</BaseModal.CancelButton>
        <BaseModal.ConfirmButton onClick={onConfirm}>Switch to previous UI</BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}
