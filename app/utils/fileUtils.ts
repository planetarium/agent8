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
