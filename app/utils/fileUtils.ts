import type { FileNode, FileSystemTree, DirectoryNode } from '~/lib/container/interfaces';
import ignore from 'ignore';
import { WORK_DIR } from './constants';
import type { FileMap } from '~/lib/.server/llm/constants';

// Common patterns to ignore, similar to .gitignore
export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
];

export const MAX_FILES = 1000;
export const ig = ignore().add(IGNORE_PATTERNS);

export const generateId = () => Math.random().toString(36).substring(2, 15);

export const isBinaryFile = async (file: File): Promise<boolean> => {
  const chunkSize = 1024;
  const buffer = new Uint8Array(await file.slice(0, chunkSize).arrayBuffer());

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];

    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
      return true;
    }
  }

  return false;
};

export const shouldIncludeFile = (path: string): boolean => {
  return !ig.ignores(path);
};

const readPackageJson = async (files: File[]): Promise<{ scripts?: Record<string, string> } | null> => {
  const packageJsonFile = files.find((f) => f.webkitRelativePath.endsWith('package.json'));

  if (!packageJsonFile) {
    return null;
  }

  try {
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(packageJsonFile);
    });

    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading package.json:', error);
    return null;
  }
};

export const detectProjectType = async (
  files: File[],
): Promise<{ type: string; setupCommand: string; followupMessage: string }> => {
  const hasFile = (name: string) => files.some((f) => f.webkitRelativePath.endsWith(name));

  if (hasFile('package.json')) {
    const packageJson = await readPackageJson(files);
    const scripts = packageJson?.scripts || {};

    // Check for preferred commands in priority order
    const preferredCommands = ['dev', 'start', 'preview'];
    const availableCommand = preferredCommands.find((cmd) => scripts[cmd]);

    if (availableCommand) {
      return {
        type: 'Node.js',
        setupCommand: `npm install && npm run ${availableCommand}`,
        followupMessage: `Found "${availableCommand}" script in package.json. Running "npm run ${availableCommand}" after installation.`,
      };
    }

    return {
      type: 'Node.js',
      setupCommand: 'npm install',
      followupMessage:
        'Would you like me to inspect package.json to determine the available scripts for running this project?',
    };
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      setupCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
};

export const filesToArtifactsNoContent = (files: { path: string; content: string }[], id: string): string => {
  return `
<boltArtifact id="${id}" title="User Updated Files">
${files.map((file) => `<boltAction type="file" filePath="${file.path}"></boltAction>`).join('\n')}
</boltArtifact>
  `;
};

// FileMap을 FileSystemTree로 변환하는 유틸리티 함수
export function convertFileMapToFileSystemTree(fileMap: FileMap): FileSystemTree {
  const fileTree: FileSystemTree = {};
  const dirSet = new Set<string>();

  if (!fileMap) {
    return {};
  }

  // 모든 디렉토리 경로 수집
  Object.keys(fileMap).forEach((path) => {
    if (fileMap[path]!.type === 'folder') {
      // WORK_DIR 제거하고 경로 추출
      const relativePath = path.replace(`${WORK_DIR}/`, '');

      if (relativePath) {
        dirSet.add(relativePath);
      }
    } else {
      // 파일의 모든 상위 디렉토리 추출
      const relativePath = path.replace(`${WORK_DIR}/`, '');
      const pathParts = relativePath.split('/');

      if (pathParts.length > 1) {
        for (let i = 1; i < pathParts.length; i++) {
          const dirPath = pathParts.slice(0, i).join('/');

          if (dirPath) {
            dirSet.add(dirPath);
          }
        }
      }
    }
  });

  // 디렉토리 구조 생성을 위한 헬퍼 함수
  const ensureDirectoryExists = (tree: FileSystemTree, path: string[]): FileSystemTree => {
    if (path.length === 0) {
      return tree;
    }

    const [current, ...rest] = path;

    if (!tree[current]) {
      tree[current] = {
        directory: {},
      } as DirectoryNode;
    }

    if (rest.length === 0) {
      return tree;
    }

    const dirNode = tree[current] as DirectoryNode;
    ensureDirectoryExists(dirNode.directory, rest);

    return tree;
  };

  // 모든 디렉토리 구조 생성
  dirSet.forEach((dirPath) => {
    const pathParts = dirPath.split('/');
    ensureDirectoryExists(fileTree, pathParts);
  });

  // 파일 추가
  Object.keys(fileMap).forEach((path) => {
    if (fileMap[path]!.type === 'file') {
      const relativePath = path.replace(`${WORK_DIR}/`, '');
      const pathParts = relativePath.split('/');
      const fileName = pathParts.pop() || '';

      let currentTree = fileTree;

      // 파일의 디렉토리 경로 탐색
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];

        if (!currentTree[part]) {
          currentTree[part] = { directory: {} } as DirectoryNode;
        }

        const dirNode = currentTree[part] as DirectoryNode;
        currentTree = dirNode.directory;
      }

      // 파일 추가
      currentTree[fileName] = {
        file: {
          contents: fileMap[path]!.content || '',
        },
      } as FileNode;
    }
  });

  return fileTree;
}

/**
 * Search file contents in FileMap by pattern
 * @param fileMap FileMap to search through
 * @param pattern Regular expression or string pattern to search for
 * @param caseSensitive Whether the search is case sensitive (default: false)
 * @param beforeLines Number of lines to include before each match (default: 0)
 * @param afterLines Number of lines to include after each match (default: 0)
 * @returns Array of search results with {path, content, matches}
 */
export function searchFileContentsByPattern(
  fileMap: FileMap,
  pattern: string | RegExp,
  caseSensitive: boolean = false,
  beforeLines: number = 0,
  afterLines: number = 0,
): Array<{
  path: string;
  content: string;
  matches: Array<{
    line: number;
    text: string;
    index: number;
    contextLines?: Array<{ line: number; text: string; isMatch: boolean }>;
  }>;
}> {
  const results: Array<{
    path: string;
    content: string;
    matches: Array<{
      line: number;
      text: string;
      index: number;
      contextLines?: Array<{ line: number; text: string; isMatch: boolean }>;
    }>;
  }> = [];

  // Create regex object
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, caseSensitive ? 'g' : 'gi');

  // Search all files
  Object.keys(fileMap).forEach((path) => {
    const file = fileMap[path];

    // Skip folders and binary files
    if (!file || file.type === 'folder' || file.isBinary) {
      return;
    }

    // Check if file matches pattern and is not in ignore list
    const relativePath = path.replace(`${WORK_DIR}/`, '');

    if (ig.ignores(relativePath)) {
      return;
    }

    const content = file.content || '';
    const lines = content.split('\n');
    const tempMatches: Array<{
      line: number;
      text: string;
      index: number;
      rangeStart: number;
      rangeEnd: number;
      contextLines?: Array<{ line: number; text: string; isMatch: boolean }>;
    }> = [];

    // Search pattern in each line
    lines.forEach((text, lineIndex) => {
      const lineMatches = [...text.matchAll(regex)];

      if (lineMatches.length > 0) {
        lineMatches.forEach((match) => {
          const matchLine = lineIndex + 1; // Line number starting at 1
          const rangeStart = Math.max(1, matchLine - beforeLines);
          const rangeEnd = Math.min(lines.length, matchLine + afterLines);

          tempMatches.push({
            line: matchLine,
            text,
            index: match.index || 0,
            rangeStart,
            rangeEnd,
            contextLines: undefined, // Temporarily set as undefined, will fill later
          });
        });
      }
    });

    // Sort results by line number
    tempMatches.sort((a, b) => a.line - b.line);

    // Merge overlapping ranges
    const mergedRanges: Array<{
      start: number;
      end: number;
      matchLines: Set<number>;
    }> = [];

    tempMatches.forEach((match) => {
      const { rangeStart, rangeEnd, line } = match;

      // Find the last overlapping range
      let overlapIndex = -1;

      for (let i = mergedRanges.length - 1; i >= 0; i--) {
        const range = mergedRanges[i];

        // If current range overlaps with existing range
        if (rangeStart <= range.end + 1) {
          overlapIndex = i;
          break;
        }
      }

      if (overlapIndex >= 0) {
        // Expand overlapping range
        const range = mergedRanges[overlapIndex];
        range.end = Math.max(range.end, rangeEnd);
        range.matchLines.add(line);
      } else {
        // Add new range
        mergedRanges.push({
          start: rangeStart,
          end: rangeEnd,
          matchLines: new Set([line]),
        });
      }
    });

    // Generate context lines for merged ranges
    const matches: Array<{
      line: number;
      text: string;
      index: number;
      contextLines?: Array<{ line: number; text: string; isMatch: boolean }>;
    }> = [];

    mergedRanges.forEach((range) => {
      const contextLines: Array<{ line: number; text: string; isMatch: boolean }> = [];

      // Add all lines in the merged range
      for (let i = range.start; i <= range.end; i++) {
        const lineIndex = i - 1; // Convert to 0-based index

        if (lineIndex >= 0 && lineIndex < lines.length) {
          contextLines.push({
            line: i,
            text: lines[lineIndex],
            isMatch: range.matchLines.has(i),
          });
        }
      }

      // Find the first match line
      const firstMatchLine = [...range.matchLines].sort((a, b) => a - b)[0];
      const firstMatchText = lines[firstMatchLine - 1] || '';

      // Add to results
      matches.push({
        line: firstMatchLine,
        text: firstMatchText,
        index: firstMatchText.search(regex),
        contextLines: contextLines.length > 1 ? contextLines : undefined,
      });
    });

    // Add to results if matches found
    if (matches.length > 0) {
      results.push({
        path,
        content,
        matches,
      });
    }
  });

  return results;
}

/**
 * Search files in FileMap by filename
 * @param fileMap FileMap to search through
 * @param pattern Regular expression or string pattern to search for
 * @param caseSensitive Whether the search is case sensitive (default: false)
 * @returns Array of found file paths and types
 */
export function searchFilesByName(
  fileMap: FileMap,
  pattern: string | RegExp,
  caseSensitive: boolean = false,
): Array<{ path: string; type: 'file' | 'folder' }> {
  const results: Array<{ path: string; type: 'file' | 'folder' }> = [];

  // Create regex object
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, caseSensitive ? 'g' : 'gi');

  // Search all files and folders
  Object.keys(fileMap).forEach((path) => {
    const file = fileMap[path];

    if (!file) {
      return;
    }

    // Check if file is not in ignore list
    const relativePath = path.replace(`${WORK_DIR}/`, '');

    if (ig.ignores(relativePath)) {
      return;
    }

    // Extract filename
    const fileName = path.split('/').pop() || '';

    // Check if filename matches pattern
    if (regex.test(fileName)) {
      results.push({
        path,
        type: file.type,
      });
    }
  });

  return results;
}

/**
 * Get full contents of a file by path
 * @param fileMap FileMap containing all files
 * @param path Path of the file to read
 * @returns File content or null if file not found or is a directory
 */
export function getFileContents(fileMap: FileMap, path: string): string | null {
  // Normalize path to ensure it includes WORK_DIR
  const fullPath = path.startsWith(WORK_DIR) ? path : `${WORK_DIR}/${path}`;

  const file = fileMap[fullPath];

  // Check if file exists and is not a directory
  if (!file || file.type === 'folder' || file.isBinary) {
    return null;
  }

  return file.content || '';
}
