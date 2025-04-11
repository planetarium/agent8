import JSZip from 'jszip';
import type { FileMap } from '~/lib/stores/files';

// ZIP 파일을 받아서 FileMap 형식으로 변환
export async function extractZipTemplate(zipBuffer: ArrayBuffer): Promise<FileMap> {
  try {
    const zip = new JSZip();
    const contents = await zip.loadAsync(zipBuffer);

    const fileMap: FileMap = {};

    // ZIP 파일 내의 모든 파일 처리
    const promises = Object.keys(contents.files).map(async (filename) => {
      const zipEntry = contents.files[filename];

      if (filename.includes('__MACOSX')) {
        return;
      }

      if (filename.includes('node_modules')) {
        return;
      }

      if (filename.includes('package-lock.json')) {
        return;
      }

      if (filename.includes('.DS_Store')) {
        return;
      }

      // 디렉토리 건너뛰기
      if (zipEntry.dir) {
        return;
      }

      try {
        // 파일 내용을 텍스트로 읽기
        const content = await zipEntry.async('string');

        // 파일 경로 생성
        const filePath = `${filename}`;

        // FileMap에 파일 추가
        fileMap[filePath] = {
          type: 'file',
          content,
          isBinary: false,
        };
      } catch (error) {
        console.error(`Error extracting file ${filename}:`, error);
      }
    });

    await Promise.all(promises);

    return fileMap;
  } catch (error) {
    console.error('Error extracting ZIP file:', error);
    throw new Error('Failed to extract ZIP file');
  }
}
