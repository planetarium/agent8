// see https://docs.anthropic.com/en/docs/about-claude/models
export const MAX_TOKENS = 8000;

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 2;

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  mimeType?: string;
  fileFormat?: string;
  buffer?: Uint8Array; // 바이너리 파일의 원본 데이터 보존
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export type Orchestration = {
  readSet: Set<string>;
  updatedSet: Set<string>;
};

export const TOOL_ERROR = {
  MISSING_FILE_CONTEXT: 'MISSING_FILE_CONTEXT',
  INVALID_JSON: 'INVALID_JSON',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
} as const;

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
  '**/*lock.json',
  '**/*lock.yml',
];
