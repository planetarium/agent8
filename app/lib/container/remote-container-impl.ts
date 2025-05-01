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
  ExecutionResult,
  PortListener,
  ServerReadyListener,
  PreviewMessageListener,
  ErrorListener,
  Unsubscribe,
} from './interfaces';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from '~/utils/promises';

type BufferEncoding =
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

interface ContainerRequest {
  id: string;
  operation: FileSystemOperation | ProcessOperation | PreviewOperation | WatchOperation | AuthOperation;
}

interface ContainerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface FileSystemOperation {
  type: 'readFile' | 'writeFile' | 'mkdir' | 'readdir' | 'rm' | 'watch' | 'mount';
  path?: string;
  content?: string | Uint8Array;
  data?: FileSystemTree;
  options?: {
    encoding?: BufferEncoding;
    withFileTypes?: boolean;
    recursive?: boolean;
    force?: boolean;
    watchOptions?: {
      persistent?: boolean;
      recursive?: boolean;
      encoding?: string;
    };
  };
}

interface ProcessOperation {
  type: 'spawn' | 'input' | 'resize' | 'kill';
  command?: string;
  args?: string[];
  pid?: number;
  data?: string;
  cols?: number;
  rows?: number;
  options?: SpawnOptions;
}

interface ProcessResponse {
  success: boolean;
  pid: number;
  process: any;
}

interface PreviewOperation {
  type: 'server-ready' | 'port' | 'preview-message';
  data?: {
    port?: number;
    type?: string;
    url?: string;
    previewId?: string;
    error?: string;
  };
}

interface WatchOperation {
  type: 'watch-paths';
  path?: string;
  options?: WatchPathsOptions;
}

interface AuthOperation {
  type: 'auth';
  token: string;
}

interface EventListeners {
  port: Set<PortListener>;
  'server-ready': Set<ServerReadyListener>;
  'preview-message': Set<PreviewMessageListener>;
  error: Set<ErrorListener>;
  'file-change': Set<FileSystemEventHandler>;
}

type FileSystemEventHandler = (eventType: string, filename: string) => void;

type EventListenerMap = {
  port: PortListener;
  'server-ready': ServerReadyListener;
  'preview-message': PreviewMessageListener;
  error: ErrorListener;
  'file-change': FileSystemEventHandler;
};

/**
 * Class to manage remote WebSocket connection and communication
 */
class RemoteContainerConnection {
  private _ws: WebSocket | null = null;
  private _requestMap = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void }>();
  private _connected = false;
  private _connectionPromise: Promise<void> | null = null;
  private _listeners: EventListeners = {
    port: new Set(),
    'server-ready': new Set(),
    'preview-message': new Set(),
    error: new Set(),
    'file-change': new Set(),
  };

  constructor(
    private _serverUrl: string,
    private _token?: string,
  ) {}

  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    if (this._connectionPromise) {
      await this._connectionPromise;
      return;
    }

    const { promise, resolve, reject } = withResolvers<void>();
    this._connectionPromise = promise;

    try {
      this._ws = new WebSocket(this._serverUrl);

      this._ws.onopen = () => {
        this._connected = true;

        // Send authentication token if available
        if (this._token) {
          this.sendRequest({
            id: 'auth-' + Date.now(),
            operation: {
              type: 'auth',
              token: this._token,
            },
          });
        }

        resolve();
      };

      this._ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (err) {
          console.error('Remote container message parsing error:', err);
        }
      };

      this._ws.onerror = (error) => {
        const err = new Error(`WebSocket connection error: ${error}`);
        this._notifyError(err);
        reject(err);
      };

      this._ws.onclose = () => {
        this._connected = false;
        this._connectionPromise = null;
        console.warn('Remote container connection closed');
      };

      await promise;
    } catch (error) {
      this._connectionPromise = null;
      throw error;
    }
  }

  async sendRequest<T>(request: ContainerRequest): Promise<ContainerResponse<T>> {
    await this.connect();

    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket connection is not open'));
        return;
      }

      this._requestMap.set(request.id, { resolve, reject });
      this._ws.send(JSON.stringify(request));
    });
  }

  private _handleMessage(message: any) {
    // Handle server events
    if (message.event) {
      switch (message.event) {
        case 'port':
          this._listeners.port.forEach((listener) => listener(message.data.port, message.data.type, message.data.url));
          break;
        case 'server-ready':
          this._listeners['server-ready'].forEach((listener) => listener(message.data.port, message.data.url));
          break;
        case 'preview-message':
          this._listeners['preview-message'].forEach((listener) => listener(message.data));
          break;
        case 'file-change':
          this._listeners['file-change'].forEach((listener) => listener(message.data.eventType, message.data.filename));
          break;
        case 'error':
          this._notifyError(new Error(message.data?.message || 'Unknown error'));
          break;
      }
      return;
    }

    // Handle request/response
    if (message.id && this._requestMap.has(message.id)) {
      const { resolve, reject } = this._requestMap.get(message.id)!;
      this._requestMap.delete(message.id);

      if (message.success) {
        resolve(message);
      } else {
        reject(new Error(message.error?.message || 'Error processing request'));
      }
    }
  }

  on<E extends keyof EventListenerMap>(event: E, listener: EventListenerMap[E]): Unsubscribe {
    if (this._listeners[event]) {
      this._listeners[event].add(listener as any);

      return () => {
        this._listeners[event].delete(listener as any);
      };
    }

    return () => {};
  }

  private _notifyError(error: Error) {
    this._listeners.error.forEach((listener) => listener(error));
  }

  close() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
      this._connected = false;
      this._connectionPromise = null;
    }

    // Clean up request map
    for (const [id, { reject }] of this._requestMap) {
      reject(new Error('Connection closed'));
      this._requestMap.delete(id);
    }
  }
}

/**
 * Remote file system implementation
 */
export class RemoteContainerFileSystem implements FileSystem {
  constructor(private _connection: RemoteContainerConnection) {}

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: BufferEncoding): Promise<string>;
  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    const response = await this._connection.sendRequest<{ content: string | Uint8Array }>({
      id: `readFile-${Date.now()}`,
      operation: {
        type: 'readFile',
        path,
        options: {
          encoding,
        },
      },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to read file');
    }

    return response.data.content;
  }

  async writeFile(path: string, content: string | Uint8Array, options?: { encoding?: BufferEncoding }): Promise<void> {
    const response = await this._connection.sendRequest({
      id: `writeFile-${Date.now()}`,
      operation: {
        type: 'writeFile',
        path,
        content,
        options,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to write file');
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const response = await this._connection.sendRequest({
      id: `mkdir-${Date.now()}`,
      operation: {
        type: 'mkdir',
        path,
        options,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to create directory');
    }
  }

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any> {
    const response = await this._connection.sendRequest<{ entries: any[] }>({
      id: `readdir-${Date.now()}`,
      operation: {
        type: 'readdir',
        path,
        options,
      },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to read directory');
    }

    return response.data.entries;
  }

  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    const response = await this._connection.sendRequest({
      id: `rm-${Date.now()}`,
      operation: {
        type: 'rm',
        path,
        options,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to delete file/directory');
    }
  }

  watch(pattern: string, options?: { persistent?: boolean }): FileSystemWatcher {
    const watcherId = `watch-${Date.now()}`;

    // Send request
    this._connection
      .sendRequest({
        id: watcherId,
        operation: {
          type: 'watch',
          path: pattern,
          options: {
            watchOptions: {
              persistent: options?.persistent,
              recursive: false,
            },
          },
        },
      })
      .catch(console.error);

    const connection = this._connection;
    const unsubscribers: Unsubscribe[] = [];

    return {
      addEventListener(event: string, listener: FileSystemEventHandler) {
        const unsubscribe = connection.on('file-change', (eventType, filename) => {
          if (event === eventType) {
            listener(eventType, filename);
          }
        });
        unsubscribers.push(unsubscribe);
      },
      close() {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      },
    };
  }

  watchPaths(options: WatchPathsOptions, _callback: (events: PathWatcherEvent[]) => void): void {
    const watcherId = `watch-paths-${Date.now()}`;

    this._connection
      .sendRequest({
        id: watcherId,
        operation: {
          type: 'watch-paths',
          options,
        },
      })
      .catch(console.error);

    // Actual server events will be processed in RemoteContainerConnection
  }
}

/**
 * Remote container implementation
 */
export class RemoteContainer implements Container {
  readonly fs: FileSystem;
  readonly workdir: string;

  private _connection: RemoteContainerConnection;

  constructor(serverUrl: string, workdir: string, token?: string) {
    this._connection = new RemoteContainerConnection(serverUrl, token);
    this.fs = new RemoteContainerFileSystem(this._connection);
    this.workdir = workdir;
  }

  on<E extends keyof EventListenerMap>(event: E, listener: EventListenerMap[E]): Unsubscribe {
    return this._connection.on(event, listener);
  }

  async mount(data: FileSystemTree): Promise<void> {
    const response = await this._connection.sendRequest({
      id: `mount-${Date.now()}`,
      operation: {
        type: 'mount',
        data,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to mount file system');
    }
  }

  async spawn(command: string, args: string[] = [], options?: SpawnOptions): Promise<any> {
    const response = await this._connection.sendRequest<ProcessResponse>({
      id: `spawn-${Date.now()}`,
      operation: {
        type: 'spawn',
        command,
        args,
        options,
      },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to execute process');
    }

    const pid = response.data.pid;

    // ContainerProcess interface implementation for remote process
    const input = {
      getWriter: () => {
        return new WritableStreamDefaultWriter<string>({
          write: async (chunk: string) => {
            await this._connection.sendRequest({
              id: `input-${Date.now()}`,
              operation: {
                type: 'input',
                pid,
                data: chunk,
              },
            });
          },
          close: () => {},
          abort: () => {},
        } as any);
      },
    };

    // Create output stream
    const { promise: exit } = withResolvers<number>();

    // ReadableStream implementation
    const output = new ReadableStream<string>({
      start(_controller) {
        /*
         * Output data from the server is received via WebSocket messages
         * In a real implementation, add output stream processing logic here
         */
      },
    });

    return {
      input,
      output,
      exit,
      resize: async (dimensions: { cols: number; rows: number }) => {
        await this._connection.sendRequest({
          id: `resize-${Date.now()}`,
          operation: {
            type: 'resize',
            pid,
            cols: dimensions.cols,
            rows: dimensions.rows,
          },
        });
      },
    };
  }

  async spawnShell(terminal: ITerminal, options: ShellOptions = {}): Promise<ShellSession> {
    const args: string[] = options.args || [];

    // Use appropriate shell command
    const process = await this.spawn('/bin/sh', [...args], {
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    const input = process.input.getWriter();
    const output = process.output;

    // Shell ready signal
    const shellReady = withResolvers<void>();
    shellReady.resolve(); // Remote shell is considered ready immediately

    // Connect output to terminal
    output.pipeTo(
      new WritableStream({
        write(data) {
          terminal.write(data);
        },
      }),
    );

    // Handle terminal input
    terminal.onData((data) => {
      input.write(data);
    });

    // Return basic shell session
    const session: ShellSession = {
      process,
      input,
      output,
      ready: shellReady.promise,
    };

    // Add advanced features if needed
    if (options.splitOutput) {
      // Command execution implementation
      session.executeCommand = async (_command: string): Promise<ExecutionResult> => {
        // Command execution and result logic would go here
        return {
          output: '',
          exitCode: 0,
        };
      };
    }

    return session;
  }
}

/**
 * Remote container factory
 */
export class RemoteContainerFactory implements ContainerFactory {
  constructor(private _serverUrl: string) {}

  async boot(options: ContainerOptions): Promise<Container> {
    try {
      const workdir = options.workdirName || '/workspace';
      const token = options.coep === 'credentialless' ? 'credentialless' : undefined;

      // Create remote container instance
      const container = new RemoteContainer(this._serverUrl, workdir, token);

      // Initialize connection
      await (container as any)._connection.connect();

      return container;
    } catch (error) {
      console.error('Failed to boot remote container:', error);
      throw error;
    }
  }
}
