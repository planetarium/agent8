import { useState, useEffect } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface ImportGithubProps {
  onImport?: (repoUrl: string) => void;
}

export const ImportGithub = ({ onImport }: ImportGithubProps) => {
  const [showModal, setShowModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
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

  const handleImport = () => {
    if (repoUrl.trim() && onImport) {
      onImport(repoUrl.trim());
      closeModal();
      setRepoUrl('');
    }
  };

  return (
    <>
      <IconButton title="Import from GitHub" className="transition-all" onClick={() => setShowModal(true)}>
        <div className="i-ph:github-logo text-xl"></div>
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
            <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Import code from GitHub</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                GitHub Repository URL
              </label>
              <input
                type="text"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                          bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 
                          text-gray-900 dark:text-gray-100"
                placeholder="https://github.com/username/repository"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleImport();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
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
              <button
                className="px-4 py-2 bg-blue-500 text-white rounded transition-colors
                          hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleImport}
                disabled={!repoUrl.trim()}
              >
                Start Chat with GitHub Code
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
