import type { FileNode, FileSystemTree, DirectoryNode } from '~/lib/container/interfaces';
import ignore from 'ignore';
import { WORK_DIR } from './constants';
import type { FileMap } from '~/lib/.server/llm/constants';
import isBinaryPath from 'is-binary-path';
import { fileTypeFromBuffer } from 'file-type';
import { getEncoding } from 'istextorbinary';
import { Buffer } from 'node:buffer';

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

export interface BinaryDetectionResult {
  isBinary: boolean;
  mimeType?: string;
  fileFormat?: string;
}

/**
 * Enhanced binary file detection using path-based and content-based analysis
 * Supports various file formats including 3D models, images, etc.
 */
export async function detectBinaryFile(filePath: string, buffer?: Uint8Array): Promise<BinaryDetectionResult> {
  // Step 1: Quick path-based detection using is-binary-path
  if (isBinaryPath(filePath)) {
    return {
      isBinary: true,
      fileFormat: getFileFormatFromPath(filePath),
    };
  }

  // Step 2: Content-based detection using file-type
  if (buffer && buffer.length > 0) {
    try {
      const fileType = await fileTypeFromBuffer(buffer.slice(0, 4100));

      if (fileType) {
        const isBinary = !fileType.mime.startsWith('text/');
        return {
          isBinary,
          mimeType: fileType.mime,
          fileFormat: fileType.ext.toUpperCase(),
        };
      }
    } catch (error) {
      // file-type failed, fall back to content analysis
      console.debug('file-type detection failed:', error);
    }

    // Step 3: Content analysis as fallback
    const contentResult = analyzeFileContent(buffer);

    if (contentResult.confidence === 'high') {
      return contentResult;
    }

    // Step 4: Enhanced content analysis with istextorbinary as final fallback
    const nodeBuffer = convertToBuffer(buffer);
    const isTextOrBinary = getEncoding(nodeBuffer, { chunkLength: 100 });

    if (isTextOrBinary === 'binary') {
      return {
        isBinary: true,
      };
    }
  }

  // Default: assume text file
  return {
    isBinary: false,
  };
}

/**
 * Analyzes file content to determine if it's binary
 */
function analyzeFileContent(buffer: Uint8Array): {
  isBinary: boolean;
  confidence: 'high' | 'medium' | 'low';
} {
  if (buffer.length === 0) {
    return { isBinary: false, confidence: 'high' };
  }

  const sampleSize = Math.min(8000, buffer.length);
  let nullBytes = 0;
  let highBytes = 0;
  let controlChars = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];

    if (byte === 0) {
      nullBytes++;
    } else if (byte > 127) {
      highBytes++;
    } else if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlChars++;
    }
  }

  // Presence of null bytes is a strong indicator of binary content
  if (nullBytes > 0) {
    return { isBinary: true, confidence: 'high' };
  }

  // High ratio of control characters or high bytes suggests binary
  const suspiciousRatio = (controlChars + highBytes) / sampleSize;

  if (suspiciousRatio > 0.3) {
    return { isBinary: true, confidence: 'high' };
  } else if (suspiciousRatio > 0.1) {
    return { isBinary: true, confidence: 'medium' };
  }

  return { isBinary: false, confidence: 'medium' };
}

/**
 * Extracts file format from file path
 */
function getFileFormatFromPath(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop();

  if (!extension) {
    return 'UNKNOWN';
  }

  // Map common extensions to readable formats
  const formatMap: Record<string, string> = {
    // Images
    png: 'PNG',
    jpg: 'JPEG',
    jpeg: 'JPEG',
    gif: 'GIF',
    webp: 'WebP',
    svg: 'SVG',
    bmp: 'BMP',
    tiff: 'TIFF',
    ico: 'ICO',

    // 3D Models
    glb: 'GLB',
    gltf: 'glTF',
    obj: 'OBJ',
    fbx: 'FBX',
    dae: 'Collada',
    stl: 'STL',
    '3ds': '3DS',
    blend: 'Blender',
    max: '3ds Max',

    // Documents
    pdf: 'PDF',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',

    // Archives
    zip: 'ZIP',
    rar: 'RAR',
    '7z': '7-Zip',
    tar: 'TAR',
    gz: 'GZIP',

    // Executables
    exe: 'Executable',
    dll: 'DLL',
    so: 'Shared Library',
    dylib: 'Dynamic Library',

    // Audio/Video
    mp3: 'MP3',
    wav: 'WAV',
    mp4: 'MP4',
    avi: 'AVI',
    mov: 'QuickTime',
    mkv: 'MKV',
    flac: 'FLAC',
    ogg: 'OGG',
  };

  return formatMap[extension] || extension.toUpperCase();
}

/**
 * Converts a `Uint8Array` into a Node.js `Buffer` by copying the prototype.
 * The goal is to avoid expensive copies. It does create a new typed array
 * but that's generally cheap as long as it uses the same underlying
 * array buffer.
 */
export function convertToBuffer(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

// Legacy function for backwards compatibility - now uses enhanced detection
export const isBinaryFile = async (file: File): Promise<boolean> => {
  const chunkSize = 4100; // Increased chunk size for better detection
  const buffer = new Uint8Array(await file.slice(0, chunkSize).arrayBuffer());
  const result = await detectBinaryFile(file.name, buffer);

  return result.isBinary;
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
      const fileData = fileMap[path]!;

      /**
       * FileMap → FileSystemTree 변환:
       * - 바이너리 파일: fileData.buffer (Uint8Array) → contents (number[])
       * - 텍스트 파일: fileData.content (string) → contents (string)
       *
       * Uint8Array를 number[]로 변환하는 이유: JSON 직렬화 시 Uint8Array는
       * 올바르게 직렬화되지 않으므로 일반 배열로 변환하여 전송
       */
      if (fileData.isBinary && fileData.buffer) {
        // 바이너리 파일: Uint8Array를 number[]로 변환 (JSON 직렬화 대응)
        currentTree[fileName] = {
          file: {
            contents: Array.from(fileData.buffer), // Uint8Array → number[]
            isBinary: true,
            mimeType: fileData.mimeType,
          },
        } as FileNode;
      } else {
        // 텍스트 파일: 문자열 그대로 사용
        currentTree[fileName] = {
          file: {
            contents: fileData.content || '', // string → string
            isBinary: false,
          },
        } as FileNode;
      }
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

export function getFullPath(path: string): string {
  // Normalize path to ensure it includes WORK_DIR
  return path.startsWith(WORK_DIR) ? path : `${WORK_DIR}/${path}`;
}

/**
 * Get full contents of a file by path
 * @param fileMap FileMap containing all files
 * @param path Path of the file to read
 * @returns File content or null if file not found or is a directory
 */
export function getFileContents(fileMap: FileMap, path: string): string | null {
  const file = fileMap[getFullPath(path)];

  // Check if file exists and is not a directory
  if (!file || file.type === 'folder' || file.isBinary) {
    return null;
  }

  return file.content || '';
}
