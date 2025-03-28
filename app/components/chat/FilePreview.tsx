import React, { useState, useEffect } from 'react';
import { ClientOnly } from 'remix-utils/client-only';

interface FilePreviewProps {
  attachmentUrlList: string[];
  onRemove?: (index: number) => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({ attachmentUrlList, onRemove }) => {
  if (!attachmentUrlList || attachmentUrlList.length === 0) {
    return null;
  }

  // 파일 유형 확인 함수
  const getFileType = (url: string): 'image' | 'audio' | 'video' | '3d' | 'text' | 'other' => {
    const lowerUrl = url.toLowerCase();

    // 이미지 확인
    if (
      lowerUrl.endsWith('.png') ||
      lowerUrl.endsWith('.jpg') ||
      lowerUrl.endsWith('.jpeg') ||
      lowerUrl.endsWith('.gif') ||
      lowerUrl.endsWith('.svg') ||
      lowerUrl.endsWith('.webp')
    ) {
      return 'image';
    }

    // 오디오 확인
    if (
      lowerUrl.endsWith('.mp3') ||
      lowerUrl.endsWith('.wav') ||
      lowerUrl.endsWith('.ogg') ||
      lowerUrl.endsWith('.m4a')
    ) {
      return 'audio';
    }

    // 비디오 확인
    if (lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.webm') || lowerUrl.endsWith('.mov')) {
      return 'video';
    }

    // 3D 모델 확인
    if (lowerUrl.endsWith('.glb') || lowerUrl.endsWith('.gltf')) {
      return '3d';
    }

    // 텍스트 파일 확인
    if (
      lowerUrl.endsWith('.txt') ||
      lowerUrl.endsWith('.json') ||
      lowerUrl.endsWith('.md') ||
      lowerUrl.endsWith('.csv') ||
      lowerUrl.endsWith('.xml') ||
      lowerUrl.endsWith('.yaml') ||
      lowerUrl.endsWith('.yml')
    ) {
      return 'text';
    }

    // 기타 파일
    return 'other';
  };

  // 파일명 추출 함수
  const getFileName = (url: string): string => {
    const parts = url.split('/');
    return parts[parts.length - 1].split('?')[0]; // URL 매개변수 제거
  };

  // 파일 확장자 추출 함수
  const getFileExtension = (url: string): string => {
    const fileName = getFileName(url);
    const parts = fileName.split('.');

    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
  };

  const Model3dPreview = ({ url, fileName }: { url: string; fileName: string }) => {
    return (
      <ClientOnly
        fallback={
          <div className="min-h-[100px] flex flex-col items-center justify-center p-2">
            <div className="i-ph:cube-duotone text-2xl text-bolt-elements-textHighlight"></div>
            <div className="text-xs text-bolt-elements-textSecondary mt-1 text-center">{fileName} (로딩 중...)</div>
          </div>
        }
      >
        {() => {
          // 동적으로 ModelViewer 컴포넌트 가져오기
          const ModelViewerComponent = () => {
            const [ModelViewer, setModelViewer] = useState<any>(null);

            useEffect(() => {
              import('~/components/ui/ModelViewer').then((module) => {
                setModelViewer(() => module.ModelViewer);
              });
            }, []);

            if (!ModelViewer) {
              return (
                <div className="min-h-[100px] flex flex-col items-center justify-center p-2">
                  <div className="i-ph:cube-duotone text-2xl text-bolt-elements-textHighlight"></div>
                  <div className="text-xs text-bolt-elements-textSecondary mt-1 text-center">
                    {fileName} (로딩 중...)
                  </div>
                </div>
              );
            }

            return (
              <div className="min-h-[100px] w-[120px]">
                <ModelViewer url={url} width="100%" height="100px" />
                <div className="text-xs text-bolt-elements-textSecondary mt-1 text-center pb-2">{fileName}</div>
              </div>
            );
          };

          return <ModelViewerComponent />;
        }}
      </ClientOnly>
    );
  };

  // 각 파일 유형에 맞는 미리보기 렌더링
  const renderPreview = (url: string, index: number) => {
    const fileType = getFileType(url);
    const fileName = getFileName(url);
    const fileExt = getFileExtension(url);

    return (
      <div key={url} className="mr-2 relative bg-bolt-elements-background-depth-3 rounded overflow-hidden">
        <div className="relative min-w-[100px]">
          {fileType === 'image' && <img src={url} alt={fileName} className="max-h-20 min-h-[60px] object-contain" />}

          {fileType === 'audio' && (
            <div className="min-h-[60px] flex flex-col items-center justify-center p-2">
              <div className="i-ph:speaker-high-duotone text-2xl text-bolt-elements-textSecondary mb-1"></div>
              <audio controls className="max-w-[150px] h-6">
                <source src={url} />
                Your browser does not support audio.
              </audio>
              <div className="text-xs text-bolt-elements-textSecondary mt-1 text-center">{fileName}</div>
            </div>
          )}

          {fileType === 'video' && (
            <div className="min-h-[80px] flex flex-col items-center justify-center p-2">
              <div className="i-ph:video-duotone text-2xl text-bolt-elements-textSecondary mb-1"></div>
              <div className="text-xs text-bolt-elements-textSecondary text-center">{fileName}</div>
              <video controls className="max-h-20 mt-1">
                <source src={url} />
                Your browser does not support video.
              </video>
            </div>
          )}

          {fileType === '3d' && <Model3dPreview url={url} fileName={fileName} />}

          {fileType === 'text' && (
            <div className="min-h-[60px] flex flex-col items-center justify-center p-2">
              <div className="i-ph:file-text-duotone text-2xl text-bolt-elements-textSecondary"></div>
              <div className="text-xs text-bolt-elements-textSecondary mt-1 text-center">{fileName}</div>
            </div>
          )}

          {fileType === 'other' && (
            <div className="min-h-[60px] flex flex-col items-center justify-center p-2">
              <div className="i-ph:file-duotone text-2xl text-bolt-elements-textSecondary"></div>
              <div className="text-xs text-bolt-elements-textPrimary font-medium mt-1">{fileExt}</div>
              <div className="text-xs text-bolt-elements-textSecondary text-center truncate max-w-[100px]">
                {fileName}
              </div>
            </div>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(index)}
              className="absolute top-1 right-1 z-10 bg-black/70 rounded-full w-5 h-5 shadow-md hover:bg-gray-900 transition-colors flex items-center justify-center"
            >
              <div className="i-ph:x w-3 h-3 text-gray-200" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-row overflow-x-auto gap-2 py-2">
      {attachmentUrlList.map((url, index) => renderPreview(url, index))}
    </div>
  );
};

export default FilePreview;
