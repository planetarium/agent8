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
    <BaseModal isOpen={isOpen} onClose={onClose} title="Switch to the Old UI?">
      <div
        className={classNames('flex flex-col items-start gap-4 self-stretch', {
          'pb-4': isSmallViewport,
        })}
      >
        <span className="text-body-md-medium text-tertiary self-stretch pb-4">
          If you did not merge the work you were previously working on, you must merge it in the old UI. Old UI will be
          removed soon, so please merge the old tasks.
        </span>
      </div>
      <BaseModal.Actions>
        <BaseModal.CancelButton onClick={onClose}>Stay on New UI</BaseModal.CancelButton>
        <BaseModal.ConfirmButton onClick={onConfirm}>Switch to Old UI</BaseModal.ConfirmButton>
      </BaseModal.Actions>
    </BaseModal>
  );
}
