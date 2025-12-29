import BaseModal from '~/components/ui/BaseModal';
import QRCode from 'react-qr-code';
import CustomButton from '~/components/ui/CustomButton';

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  title: string;
  description?: string | React.ReactNode;
}

export default function QrCodeModal({ isOpen, onClose, value, title, description }: QrCodeModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} isHiddenTitleSection={true} modalClassName="!w-[348px]">
      <div className="flex flex-col items-center">
        <div className="rounded-[16px] border border-tertiary bg-transperant-subtle p-4">
          <QRCode size={120} value={value} />
        </div>
        <strong className="mt-3 text-primary text-heading-md">{title}</strong>
        <p className="mt-2 text-tertiary text-body-md-medium text-center">{description}</p>
        <CustomButton className="w-full mt-8" variant="primary-filled" size="lg" onClick={onClose}>
          Close
        </CustomButton>
      </div>
    </BaseModal>
  );
}
