import { useState, useEffect } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';
import { ImportGithub } from './ImportGithub';
import { ImportProjectZip } from './ImportProjectZip';

interface ImportProjectProps {
  onGithubImport?: (repoUrl: string) => void;
  onZipImport?: (title: string, zipFile: File) => void;
}

export const ImportProject = ({ onGithubImport, onZipImport }: ImportProjectProps) => {
  const [showModal, setShowModal] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [showModal]);

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShowModal(false);
      setIsClosing(false);
    }, 300);
  };

  return (
    <>
      <IconButton title="Import Project" className="transition-all" onClick={() => setShowModal(true)}>
        <div className="i-ph:import text-xs">Import Project</div>
      </IconButton>

      {showModal && (
        <div
          className={classNames(
            'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300',
            isClosing ? 'opacity-0' : 'opacity-100',
          )}
          onClick={closeModal}
        >
          <div
            className={classNames(
              'bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md shadow-xl border border-gray-200 dark:border-gray-700 transition-all duration-300',
              isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Import Project</h3>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <ImportGithub onImport={onGithubImport} />
              <ImportProjectZip onImport={onZipImport} />
            </div>

            <div className="flex justify-end">
              <button
                className="px-4 py-2 border rounded transition-colors
                          bg-gray-100 dark:bg-gray-700
                          border-gray-300 dark:border-gray-600
                          text-gray-700 dark:text-gray-300
                          hover:bg-gray-200 dark:hover:bg-gray-600"
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
