/**
 * Protocol definitions for remote container communication
 * This file can be shared between client and server projects
 */

// Stream-related type definitions
export interface WritableStreamDefaultWriter<T> {
  write(chunk: T): Promise<void>;
  close(): Promise<void>;
  abort(reason?: any): Promise<void>;

  // Additional properties needed for compatibility
  closed: Promise<void>;
  desiredSize: number | null;
  ready: Promise<void>;
  releaseLock(): void;
}

// Basic types definitions
export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

// Spawn options type definition
export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  terminal?: {
    cols: number;
    rows: number;
  };
}

// Watch paths options type definition
export interface WatchPathsOptions {
  include?: string[];
  exclude?: string[];
  includeContent?: boolean;
}

// Event listener type definitions
export type PortListener = (port: number, type: string, url?: string) => void;
export type ServerReadyListener = (port: number, url?: string) => void;
export type PreviewMessageListener = (data: any) => void;
export type ErrorListener = (error: Error) => void;
export type FileSystemEventHandler = (eventType: string, filename: string) => void;

// Request and response types
export interface ContainerRequest {
  id: string;
  operation:
    | FileSystemOperation
    | ProcessOperation
    | PreviewOperation
    | WatchOperation
    | WatchPathsOperation
    | AuthOperation;
}

export interface ContainerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// Operation type definitions
export interface FileSystemOperation {
  type: 'readFile' | 'writeFile' | 'mkdir' | 'readdir' | 'rm' | 'mount';
  path?: string;
  content?: string | Uint8Array;
  options?: {
    encoding?: BufferEncoding;
    withFileTypes?: boolean;
    recursive?: boolean;
    force?: boolean;
  };
}

export interface ProcessOperation {
  type: 'spawn' | 'input' | 'resize' | 'kill';
  command?: string;
  args?: string[];
  pid?: number;
  data?: string;
  cols?: number;
  rows?: number;
  options?: SpawnOptions;
}

export interface ProcessResponse {
  success: boolean;
  pid: number;
  process: any;
}

export interface PreviewOperation {
  type: 'server-ready' | 'port' | 'preview-message';
  data?: {
    port?: number;
    type?: string;
    url?: string;
    previewId?: string;
    error?: string;
  };
}

export interface WatchOperation {
  type: 'watch';
  options?: {
    patterns?: string[];
    persistent?: boolean;
  };
}

export interface WatchPathsOperation {
  type: 'watch-paths';
  options?: WatchPathsOptions;
}

export interface AuthOperation {
  type: 'auth';
  token: string;
}

// Event listeners collection
export interface EventListeners {
  port: Set<PortListener>;
  'server-ready': Set<ServerReadyListener>;
  'preview-message': Set<PreviewMessageListener>;
  error: Set<ErrorListener>;
  'file-change': Set<FileSystemEventHandler>;
}

// Event listener map for typed event subscription
export type EventListenerMap = {
  port: PortListener;
  'server-ready': ServerReadyListener;
  'preview-message': PreviewMessageListener;
  error: ErrorListener;
  'file-change': FileSystemEventHandler;
};

// Container process interface
export interface ContainerProcess {
  input: {
    getWriter(): WritableStreamDefaultWriter<string>;
  };
  output: ReadableStream<string>;
  exit: Promise<number>;
  resize(dimensions: { cols: number; rows: number }): void;
}

// Shell related interfaces
export interface ShellOptions {
  args?: string[];
  interactive?: boolean;
  splitOutput?: boolean;
}

export interface ExecutionResult {
  output: string;
  exitCode: number;
}

export interface ShellSession {
  process: ContainerProcess;
  input: WritableStreamDefaultWriter<string>;
  output: ReadableStream<string>;
  internalOutput?: ReadableStream<string>;
  ready: Promise<void>;

  executeCommand?(command: string): Promise<ExecutionResult>;
  waitTillOscCode?(code: string): Promise<{ output: string; exitCode: number }>;
}
