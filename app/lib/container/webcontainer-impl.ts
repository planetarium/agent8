import { WebContainer, type FileSystemAPI } from '@webcontainer/api';
import type { BufferEncoding as WCBufferEncoding } from '@webcontainer/api';
import type {
  Container,
  ContainerFactory,
  ContainerOptions,
  FileSystem,
  FileSystemTree,
  FileSystemWatcher,
  PathWatcherEvent,
  WatchPathsOptions,
  SpawnOptions,
} from './interfaces';

/**
 * WebContainer file system implementation
 */
export class WebContainerFileSystem implements FileSystem {
  constructor(private _nativeFs: FileSystemAPI) {}

  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    const wcEncoding = encoding as WCBufferEncoding;
    return this._nativeFs.readFile(path, wcEncoding);
  }

  async writeFile(path: string, content: string | Uint8Array, options?: { encoding?: string }): Promise<void> {
    return this._nativeFs.writeFile(path, content, options);
  }

  mkdir(path: string, options?: { recursive?: false }): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  async mkdir(path: string, options: any): Promise<void> {
    await this._nativeFs.mkdir(path, options);
  }

  async readdir(path: string, options?: { encoding?: BufferEncoding; withFileTypes?: boolean }): Promise<any> {
    const wcEncoding = options?.encoding as WCBufferEncoding;
    const withFileTypes = options?.withFileTypes ?? false;

    if (withFileTypes) {
      return this._nativeFs.readdir(path, { encoding: wcEncoding, withFileTypes: true });
    }

    return this._nativeFs.readdir(path, { encoding: wcEncoding });
  }

  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    return this._nativeFs.rm(path, options);
  }

  watch(pattern: string, options?: { persistent?: boolean }): FileSystemWatcher {
    return this._nativeFs.watch(pattern, options) as FileSystemWatcher;
  }
}

/**
 * WebContainer factory - Create WebContainer instances
 */
export class WebContainerFactory implements ContainerFactory {
  async boot(options: ContainerOptions): Promise<Container> {
    try {
      const container = await WebContainer.boot(options);

      // Directly implement the Container interface instead of using an adapter
      return {
        fs: new WebContainerFileSystem(container.fs),
        workdir: container.workdir,
        mount: (data: FileSystemTree) => {
          return container.mount(data);
        },
        spawn: async (command: string, args?: string[], options?: SpawnOptions) => {
          const process = await container.spawn(command, args || [], options);
          return {
            input: process.input,
            output: process.output,
            exit: process.exit,
            resize: (dimensions) => process.resize(dimensions),
          };
        },
        internal: {
          watchPaths: (options: WatchPathsOptions, callback: (events: PathWatcherEvent[]) => void) => {
            return container.internal.watchPaths(options, callback);
          },
        },
        on(event: 'port' | 'server-ready' | 'preview-message' | 'error', listener: any) {
          return (container as any).on(event, listener);
        },
      };
    } catch (error) {
      console.error('WebContainer boot failed:', error);
      throw error;
    }
  }
}
