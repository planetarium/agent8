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
  ShellSession,
  ShellOptions,
} from './interfaces';
import type { ITerminal } from '~/types/terminal';
import { RemoteContainerFactory } from './remote-container-impl';

/**
 * WebContainer file system implementation
 */
export class WebContainerFileSystem implements FileSystem {
  constructor(
    private _nativeFs: FileSystemAPI,
    private _wc: WebContainer,
    private _rfs: FileSystem,
  ) {}

  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    const wcEncoding = encoding as WCBufferEncoding;
    return this._nativeFs.readFile(path, wcEncoding);
  }

  async writeFile(path: string, content: string | Uint8Array, options?: { encoding?: string }): Promise<void> {
    await this._rfs.writeFile(path, content, options);
    return this._nativeFs.writeFile(path, content, options);
  }

  mkdir(path: string, options?: { recursive?: false }): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  async mkdir(path: string, options: any): Promise<void> {
    await this._rfs.mkdir(path, options);
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
    await this._rfs.rm(path, options);
    return this._nativeFs.rm(path, options);
  }

  watch(pattern: string, options?: { persistent?: boolean }): FileSystemWatcher {
    return this._nativeFs.watch(pattern, options) as FileSystemWatcher;
  }

  watchPaths(options: WatchPathsOptions, callback: (events: PathWatcherEvent[]) => void): void {
    this._wc.internal.watchPaths(options, callback);
  }
}

/**
 * WebContainer factory - Create WebContainer instances
 */
export class WebContainerFactory implements ContainerFactory {
  async boot(options: ContainerOptions): Promise<Container> {
    try {
      const container = await WebContainer.boot(options);
      const rfactory = new RemoteContainerFactory('ws://localhost:53000');
      const rcontainer = await rfactory.boot({ workdirName: container.workdir });

      // Directly implement the Container interface instead of using an adapter
      return {
        fs: new WebContainerFileSystem(container.fs, container, rcontainer.fs),
        workdir: container.workdir,
        mount: (data: FileSystemTree) => {
          rcontainer.mount(data);
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
        on(event: 'port' | 'server-ready' | 'preview-message' | 'error', listener: any) {
          return (container as any).on(event, listener);
        },
        spawnShell: async (terminal: ITerminal, options: ShellOptions = {}): Promise<ShellSession> => {
          return rcontainer.spawnShell(terminal, options);
        },
      };
    } catch (error) {
      console.error('WebContainer boot failed:', error);
      throw error;
    }
  }
}
