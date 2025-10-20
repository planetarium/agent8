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

        const { result: binaryDetectionResult, buffer: detectionBuffer } = await detectBinaryFileInZip(
          filePath,
          zipEntry,
        );
        let content = '';
        let buffer: Uint8Array | undefined;

        /**
         * 파일 타입별 데이터 저장:
         * - 바이너리 파일: buffer에 원본 Uint8Array 저장, content는 빈 문자열
         * - 텍스트 파일: content에 UTF-8 문자열 저장, buffer는 undefined
         *
         * content 필드를 string | Uint8Array로 변경하지 않고 별도 buffer 필드를 추가한 이유:
         * 기존 FileMap 인터페이스와 이를 사용하는 코드들의 변경을 최소화
         */
        if (binaryDetectionResult.isBinary) {
          // 바이너리 파일: 감지 시 읽은 버퍼를 재사용 (중복 읽기 방지)
          buffer = detectionBuffer;

          // content는 빈 문자열로 유지 (기존 코드 호환성)
        } else {
          // 텍스트 파일: 문자열 데이터를 content에 저장
          content = await zipEntry.async('string');

          // buffer는 undefined로 유지
        }

        fileMap[filePath] = {
          type: 'file',
          content, // 바이너리: '', 텍스트: 실제 내용
          isBinary: binaryDetectionResult.isBinary,
          mimeType: binaryDetectionResult.mimeType,
          fileFormat: binaryDetectionResult.fileFormat,
          buffer, // 바이너리: 실제 데이터, 텍스트: undefined
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
 * 통합된 detectBinaryFile 함수를 사용하며, 버퍼도 함께 반환하여 중복 읽기 방지
 */
async function detectBinaryFileInZip(
  filePath: string,
  zipEntry: JSZip.JSZipObject,
): Promise<{ result: BinaryDetectionResult; buffer: Uint8Array }> {
  // ZIP 파일에서 버퍼를 한 번만 읽어서 감지 결과와 함께 반환
  const buffer = await zipEntry.async('uint8array');
  const result = await detectBinaryFile(filePath, buffer);

  return { result, buffer };
}
