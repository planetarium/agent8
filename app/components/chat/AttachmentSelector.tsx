import { useEffect, useState } from 'react';
import { ImportProjectZip } from './ImportProjectZip';

interface AttachmentSelectorProps {
  onImportProject?: (title: string, zipFile: File) => void;
  onUploadFile: () => void;
  chatStarted: boolean;
  onDropdownOpenChange?: (isOpen: boolean) => void;
  onImportProjectModalChange?: (isOpen: boolean) => void;
}

export const AttachmentSelector = ({
  onImportProject,
  onUploadFile,
  chatStarted,
  onDropdownOpenChange,
  onImportProjectModalChange,
}: AttachmentSelectorProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (_event: MouseEvent) => {
      if (isOpen) {
        setIsOpen(false);
        onDropdownOpenChange?.(false);
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, onDropdownOpenChange]);

  const handleImportProject = () => {
    setIsOpen(false);
    onDropdownOpenChange?.(false);
    setShowImportModal(true);
    onImportProjectModalChange?.(true);
  };

  const handleUploadFile = () => {
    setIsOpen(false);
    onDropdownOpenChange?.(false);
    onUploadFile();
  };

  return (
    <div className="relative flex justify-center items-center gap-1.5">
      <button
        className="flex items-center text-bolt-elements-item-contentDefault bg-transparent enabled:hover:text-bolt-elements-item-contentActive rounded-md p-2 disabled:cursor-not-allowed transition-all"
        onClick={(e) => {
          e.stopPropagation();

          if (chatStarted) {
            onUploadFile();
            return;
          }

          const newIsOpen = !isOpen;
          setIsOpen(newIsOpen);
          onDropdownOpenChange?.(newIsOpen);
        }}
      >
        <img src="/icons/Attach.svg" alt="Attach" />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full mb-1 left-0 flex flex-col items-start w-[185.6px] px-0 py-[var(--spacing-8,6.4px)] z-[9999] rounded-radius-8 border border-solid border-[var(--color-border-tertiary,rgba(255,255,255,0.12))] bg-interactive-neutral"
          style={{
            boxShadow: '0px 8px 16px 0px rgba(0, 0, 0, 0.32), 0px 0px 8px 0px rgba(0, 0, 0, 0.28)',
          }}
        >
          <button
            onClick={handleUploadFile}
            className="w-full gap-3 px-4 py-2 text-left bg-transparent hover:bg-bolt-elements-item-backgroundActive transition-colors text-bolt-elements-textPrimary text-[13px] flex items-center gap-2"
          >
            <img src="/icons/File.svg" alt="Upload" />
            Upload local files
          </button>
          {!chatStarted && onImportProject && (
            <button
              onClick={handleImportProject}
              className="w-full gap-3 px-4 py-2 text-left bg-transparent hover:bg-bolt-elements-item-backgroundActive transition-colors text-bolt-elements-textPrimary text-[13px] flex items-center gap-2"
            >
              <img src="/icons/Package.svg" alt="Import" />
              Import Project
            </button>
          )}
        </div>
      )}

      {!chatStarted && (
        <ImportProjectZip
          onImport={onImportProject}
          showModal={showImportModal}
          setShowModal={(show) => {
            setShowImportModal(show);
            onImportProjectModalChange?.(show);
          }}
        />
      )}
    </div>
  );
};
