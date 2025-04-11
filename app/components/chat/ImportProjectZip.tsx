import { useState, useEffect, useRef } from 'react';
import { classNames } from '~/utils/classNames';
import { IconButton } from '~/components/ui/IconButton';

interface ImportProjectZipProps {
  onImport?: (title: string, zipFile: File) => void;
}

export const ImportProjectZip = ({ onImport }: ImportProjectZipProps) => {
  const [showModal, setShowModal] = useState(false);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setZipFile(null);
      setProjectTitle('');
    }, 300);
  };

  const handleImport = () => {
    if (zipFile && onImport) {
      onImport(projectTitle, zipFile);
      closeModal();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;

    if (files && files.length > 0) {
      const file = files[0];

      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        setZipFile(file);

        // 파일명에서 확장자를 제거하여 기본 프로젝트 이름으로 설정
        const fileName = file.name.replace(/\.zip$/, '');

        if (!projectTitle) {
          setProjectTitle(fileName);
        }
      } else {
        alert('Please select a valid ZIP file.');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;

    if (files && files.length > 0) {
      const file = files[0];

      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        setZipFile(file);

        // 파일명에서 확장자를 제거하여 기본 프로젝트 이름으로 설정
        const fileName = file.name.replace(/\.zip$/, '');

        if (!projectTitle) {
          setProjectTitle(fileName);
        }
      } else {
        alert('Please select a valid ZIP file.');
      }
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
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
            <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Import Project from ZIP File</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Project Title</label>
              <input
                type="text"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                          bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 
                          text-gray-900 dark:text-gray-100"
                placeholder="Enter project title"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">ZIP File</label>

              <input type="file" ref={fileInputRef} accept=".zip" onChange={handleFileChange} className="hidden" />

              <div
                className={classNames(
                  'border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors',
                  isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-400',
                  zipFile ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : '',
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={triggerFileInput}
              >
                {zipFile ? (
                  <>
                    <div className="i-ph:check-circle-duotone text-3xl text-green-500 mb-2"></div>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">{zipFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {(zipFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </>
                ) : (
                  <>
                    <div className="i-ph:upload-simple-duotone text-3xl text-gray-400 dark:text-gray-500 mb-2"></div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Drag and drop your ZIP file here
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">or click to browse files</p>
                  </>
                )}
              </div>

              {zipFile && (
                <div className="flex items-center justify-end mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setZipFile(null);

                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Remove file
                  </button>
                </div>
              )}
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
                disabled={!zipFile || !projectTitle.trim()}
              >
                Start Chat with ZIP Project
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
