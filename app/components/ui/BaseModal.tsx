import React from 'react';
import { createPortal } from 'react-dom';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { classNames } from '~/utils/classNames';
import { CloseIcon } from '~/components/ui/Icons';
import CustomButton from '~/components/ui/CustomButton';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children?: React.ReactNode;
}

interface ActionsProps {
  children: React.ReactNode;
}

interface CancelButtonProps {
  children?: React.ReactNode;
  onClick?: () => void;
}

interface ConfirmButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

// Actions container component
function Actions({ children }: ActionsProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  return (
    <div className="flex flex-col items-start gap-[10px] self-stretch">
      <div
        className={classNames('flex items-center gap-3 self-stretch', {
          'justify-end': !isSmallViewport,
          'flex-col-reverse': isSmallViewport,
        })}
      >
        {children}
      </div>
    </div>
  );
}

// Cancel button component
function CancelButton({ children = 'Cancel', onClick }: CancelButtonProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  return (
    <CustomButton
      className={isSmallViewport ? 'w-full' : ''}
      variant="secondary-ghost"
      size="lg"
      type="button"
      onClick={onClick}
    >
      {children}
    </CustomButton>
  );
}

// Confirm button component
function ConfirmButton({ children, onClick, disabled, type = 'button' }: ConfirmButtonProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  return (
    <CustomButton
      className={isSmallViewport ? 'w-full' : ''}
      variant="primary-filled"
      size="lg"
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </CustomButton>
  );
}

// Destructive button component (for delete actions)
function DestructiveButton({ children, onClick, disabled, type = 'button' }: ConfirmButtonProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  return (
    <CustomButton
      className={isSmallViewport ? 'w-full' : ''}
      variant="destructive-filled"
      size="lg"
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </CustomButton>
  );
}

// Main BaseModal component
export function BaseModal({ isOpen, onClose, title, children }: BaseModalProps) {
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  if (!isOpen) {
    return null;
  }

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
        <div className="flex items-center gap-2 self-stretch">
          <span className="text-primary text-heading-md flex-[1_0_0]">{title}</span>
          <button onClick={onClose} className="bg-transparent p-2 justify-center items-center gap-1.5">
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        {/* Content & Actions */}
        {children}
      </div>
    </div>,
    document.body,
  );
}

// Attach sub-components
BaseModal.Actions = Actions;
BaseModal.CancelButton = CancelButton;
BaseModal.ConfirmButton = ConfirmButton;
BaseModal.DestructiveButton = DestructiveButton;

export default BaseModal;
