import JSZip from 'jszip';
import type { FileMap } from '~/lib/stores/files';

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

  // 파일 처리
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      const promise = async () => {
        const content = await zipEntry.async('string');

        // 경로에서 첫 번째 폴더(프로젝트 루트)를 제거
        const pathParts = relativePath.split('/');

        if (pathParts.length > 1) {
          pathParts.shift(); // 첫 번째 경로 부분(프로젝트 폴더) 제거
        }

        const filePath = pathParts.join('/');

        // FileMap에 추가
        fileMap[filePath] = {
          type: 'file',
          content,
          isBinary: false,
        };
      };

      promises.push(promise());
    }
  });

  await Promise.all(promises);

  return fileMap;
}

/**
 * Extract issue IID from branch name
 * Supports patterns like: issue-123, issue-123-description, 123-issue, etc.
 */
export function extractIssueIidFromBranch(branchName: string): number | null {
  if (!branchName) {
    return null;
  }

  // Pattern 1: issue-123 or issue-123-description
  const issuePattern1 = /^issue-(\d+)/i;
  const match1 = branchName.match(issuePattern1);

  if (match1) {
    return parseInt(match1[1], 10);
  }

  // Pattern 2: 123-issue or 123-description
  const issuePattern2 = /^(\d+)-/;
  const match2 = branchName.match(issuePattern2);

  if (match2) {
    return parseInt(match2[1], 10);
  }

  // Pattern 3: contains -123- or -123 at end
  const issuePattern3 = /-(\d+)(?:-|$)/;
  const match3 = branchName.match(issuePattern3);

  if (match3) {
    return parseInt(match3[1], 10);
  }

  return null;
}
