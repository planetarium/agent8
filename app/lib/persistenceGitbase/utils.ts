import JSZip from 'jszip';
import type { FileMap } from '~/lib/stores/files';
import { detectBinaryFile, type BinaryDetectionResult } from '~/utils/fileUtils';

export function isCommitHash(id: string | undefined) {
  return id?.length === 40 && /^[0-9a-fA-F]+$/.test(id);
}

export function isCommitedMessage(id: string | undefined) {
  return isCommitHash(id?.split('-').pop());
}

export async function unzipCode(zipBlob: Buffer) {
  // Load zip file using JSZip
  const zip = await JSZip.loadAsync(zipBlob);

  // Process zip contents into FileMap structure
  const fileMap: FileMap = {};
  const dirSet = new Set<string>(); // 디렉토리 경로 추적용 Set

  // 먼저 모든 디렉토리 경로를 수집
  zip.forEach((relativePath) => {
    // 경로에서 첫 번째 폴더(프로젝트 루트)를 제거
    const pathParts = relativePath.split('/');

    if (pathParts.length > 1) {
      pathParts.shift(); // 첫 번째 경로 부분(프로젝트 폴더) 제거
    }

    // 파일 경로의 모든 상위 디렉토리를 찾아 dirSet에 추가
    if (pathParts.length > 1) {
      for (let i = 1; i < pathParts.length; i++) {
        const dirPath = pathParts.slice(0, i).join('/');

        if (dirPath) {
          dirSet.add(dirPath);
        }
      }
    }
  });

  // 디렉토리 먼저 FileMap에 추가
  dirSet.forEach((dirPath) => {
    fileMap[dirPath] = {
      type: 'folder',
    };
  });

  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      const promise = async () => {
        // 경로에서 첫 번째 폴더(프로젝트 루트)를 제거
        const pathParts = relativePath.split('/');

        if (pathParts.length > 1) {
          pathParts.shift(); // 첫 번째 경로 부분(프로젝트 폴더) 제거
        }

        const filePath = pathParts.join('/');

        const binaryDetectionResult = await detectBinaryFileInZip(filePath, zipEntry);
        let content = '';

        if (!binaryDetectionResult.isBinary) {
          content = await zipEntry.async('string');
        }

        fileMap[filePath] = {
          type: 'file',
          content,
          isBinary: binaryDetectionResult.isBinary,
          mimeType: binaryDetectionResult.mimeType,
          fileFormat: binaryDetectionResult.fileFormat,
        };
      };

      promises.push(promise());
    }
  });

  await Promise.all(promises);

  return fileMap;
}

/**
 * ZIP 파일 내부의 파일에 대한 바이너리 감지
 * 통합된 detectBinaryFile 함수를 사용
 */
async function detectBinaryFileInZip(filePath: string, zipEntry: JSZip.JSZipObject): Promise<BinaryDetectionResult> {
  // ZIP 파일에서 버퍼를 읽어서 통합된 함수에 전달
  const buffer = await zipEntry.async('uint8array');
  return detectBinaryFile(filePath, buffer);
}
