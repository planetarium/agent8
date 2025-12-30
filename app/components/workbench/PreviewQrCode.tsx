import * as Tooltip from '@radix-ui/react-tooltip';
import { useState } from 'react';
import { QrCodeIcon } from '~/components/ui/Icons';
import QrCodeModal from '~/components/ui/QrCodeModal';

interface PreviewQrCodeProps {
  className?: string;
  value?: string;
}

export default function PreviewQrCode({ className, value }: PreviewQrCodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <div className={className}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              disabled={!value}
              className="p-2 rounded-[4px] border border-interactive-neutral bg-interactive-neutral hover:border-interactive-neutral-hover hover:bg-interactive-neutral-hover active:border-interactive-neutral-pressed active:bg-interactive-neutral-pressed disabled:border-disabled disabled:bg-disabled"
              onClick={() => setIsOpen(true)}
            >
              <QrCodeIcon color={value ? '#F3F5F8' : 'rgba(255, 255, 255, 0.18)'} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              sideOffset={10}
              align="end"
              className="!elevation-light-2 inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
            >
              <p className="text-body-lg-medium text-inverse">
                Test your game on a mobile device by scanning the Preview QR code!
                <br />
                Run Preview to make sure the current version runs correctly.
              </p>
              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
      {value && (
        <QrCodeModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          value={value}
          title="Preview QR"
          description={
            <>
              Test your game on a mobile device by scanning the Preview QR code!
              <br /> Run Preview to make sure the current version runs correctly.
            </>
          }
        />
      )}
    </>
  );
}
