import JSZip from 'jszip';

// ZIP 파일을 받아서 getGitHubRepoContent 형식과 호환되는 형태로 변환
export async function extractZipTemplate(
  zipBuffer: ArrayBuffer,
): Promise<{ name: string; path: string; content: string }[]> {
  try {
    const zip = new JSZip();
    const contents = await zip.loadAsync(zipBuffer);

    const files: { name: string; path: string; content: string }[] = [];

    // ZIP 파일 내의 모든 파일 처리
    const promises = Object.keys(contents.files).map(async (filename) => {
      const zipEntry = contents.files[filename];

      // 디렉토리 건너뛰기
      if (zipEntry.dir) {
        return;
      }

      try {
        // 파일 내용을 텍스트로 읽기
        const content = await zipEntry.async('string');

        // 파일 경로에서 이름 추출
        const name = filename.split('/').pop() || filename;

        files.push({
          name,
          path: filename,
          content,
        });
      } catch (error) {
        console.error(`Error extracting file ${filename}:`, error);
      }
    });

    await Promise.all(promises);

    return files;
  } catch (error) {
    console.error('Error extracting ZIP file:', error);
    throw new Error('Failed to extract ZIP file');
  }
}
