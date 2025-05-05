import type {
  Container,
  ContainerFactory,
  ContainerOptions,
  FileSystem,
  FileSystemTree,
  FileSystemWatcher,
  Unsubscribe,
  ContainerProcess,
  PathWatcherEvent,
  ShellSession,
} from './interfaces';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from '~/utils/promises';
import { cleanTerminalOutput } from '~/utils/shell';
import type {
  BufferEncoding,
  ContainerRequest,
  ContainerResponse,
  EventListeners,
  EventListenerMap,
  ProcessResponse,
  SpawnOptions,
  ShellOptions,
  ExecutionResult,
  WatchPathsOptions,
  WatchResponse,
} from '~/lib/shared/agent8-container-protocol/src';
import { v4 } from 'uuid';

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
  private _processListeners = new Map<string, Set<(data: any) => void>>();

  constructor(
    private _serverUrl: string,
    private _token: string,
    private _machineId: string,
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
      this._ws = new WebSocket(`${this._serverUrl}/proxy/${this._machineId}`);

      this._ws.onopen = () => {
        this._connected = true;

        // Send authentication token if available
        if (this._token) {
          this.sendRequest({
            id: 'auth-' + v4(),
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
    if (message.data?.data?.type) {
      const { data } = message.data.data;

      switch (message.data.data.type) {
        case 'port':
          this._listeners.port.forEach((listener) => listener(data.port, data.type, data.url));
          break;

        case 'server-ready':
          this._listeners['server-ready'].forEach((listener) => listener(data.port, data.url));
          break;

        case 'preview-message':
          this._listeners['preview-message'].forEach((listener) => listener(message.data));
          break;
      }

      return;
    }

    // Handle server events
    if (message.event) {
      switch (message.event) {
        case 'file-change':
          this._listeners['file-change'].forEach((listener) =>
            listener(message.data.watcherId, message.data.eventType, message.data.filename),
          );
          break;

        case 'error':
          this._notifyError(new Error(message.data?.message || 'Unknown error'));
          break;

        case 'process':
          {
            const { pid, data, stream } = message.data;
            const channel = `process:${pid}`;
            const listeners = this._processListeners.get(channel);

            if (listeners) {
              listeners.forEach((listener) => listener({ data, stream }));
            }
          }
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

    return () => {
      console.log('unregistered event:', 'on', event, listener.toString());
    };
  }

  onProcess(pid: number, listener: (data: any) => void): Unsubscribe {
    const channel = `process:${pid}`;

    if (!this._processListeners.has(channel)) {
      this._processListeners.set(channel, new Set());
    }

    this._processListeners.get(channel)!.add(listener);

    return () => {
      const listeners = this._processListeners.get(channel);

      if (listeners) {
        listeners.delete(listener);

        if (listeners.size === 0) {
          this._processListeners.delete(channel);
        }
      }
    };
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

    // Clean up process listeners
    this._processListeners.clear();
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
      id: `readFile-${v4()}`,
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
      id: `writeFile-${v4()}`,
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
      id: `mkdir-${v4()}`,
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
      id: `readdir-${v4()}`,
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
      id: `rm-${v4()}`,
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
    const requestId = `watch-${v4()}`;
    let watcherIdFromResponse: string | undefined = undefined;

    // Send request
    this._connection
      .sendRequest<WatchResponse>({
        id: requestId,
        operation: {
          type: 'watch',
          options: {
            persistent: options?.persistent,
            patterns: [pattern],
          },
        },
      })
      .then((response) => {
        watcherIdFromResponse = response.data?.watcherId;
      })
      .catch(console.error);

    const connection = this._connection;
    const unsubscribers: Unsubscribe[] = [];

    return {
      addEventListener(event: string, listener) {
        const unsubscribe = connection.on('file-change', (watcherId, eventType, filename) => {
          if (watcherId === watcherIdFromResponse) {
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

  watchPaths(options: WatchPathsOptions, callback: (events: PathWatcherEvent[]) => void): void {
    const requestId = `watch-paths-${v4()}`;
    let watcherIdFromResponse: string | undefined = undefined;

    this._connection
      .sendRequest<WatchResponse>({
        id: requestId,
        operation: {
          type: 'watch-paths',
          options,
        },
      })
      .then((response) => {
        watcherIdFromResponse = response.data?.watcherId;
      })
      .catch(console.error);

    this._connection.on('file-change', (watcherId, eventType, filename) => {
      if (watcherId === watcherIdFromResponse) {
        callback([{ type: eventType as any, path: filename }]);
      }
    });
  }
}

/**
 * Remote container implementation
 */
export class RemoteContainer implements Container {
  readonly fs: FileSystem;
  readonly workdir: string;
  readonly machine_id?: string;

  private _connection: RemoteContainerConnection;

  constructor(serverUrl: string, workdir: string, token: string, machineId: string) {
    this._connection = new RemoteContainerConnection(serverUrl, token, machineId);
    this.fs = new RemoteContainerFileSystem(this._connection);
    this.workdir = workdir;
    this.machine_id = '';

    // Fetch machine_id if token is provided
  }

  on<E extends keyof EventListenerMap>(event: E, listener: EventListenerMap[E]): Unsubscribe {
    return this._connection.on(event, listener);
  }

  async mount(data: FileSystemTree): Promise<void> {
    await this._connection.sendRequest({
      id: `mount-${v4()}`,
      operation: {
        type: 'mount',
        path: '/',
        content: JSON.stringify(data),
      },
    });
  }

  async spawn(command: string, args: string[] = [], options?: SpawnOptions): Promise<ContainerProcess> {
    const response = await this._connection.sendRequest<ProcessResponse>({
      id: `spawn-${v4()}`,
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

    const { pid } = response.data;
    const { promise: exit, resolve: resolveExit } = withResolvers<number>();

    // Create output stream
    const outputStream = new ReadableStream<string>({
      start: (controller) => {
        this._connection.onProcess(pid, (data) => {
          if (data.stream === 'exit') {
            process.nextTick(() => {
              resolveExit(parseInt(data.data, 10));
              controller.close();
            });
          } else {
            controller.enqueue(data.data);
          }
        });
      },
    });

    // Create input stream
    const inputStream = new WritableStream<string>({
      write: async (chunk) => {
        await this._connection.sendRequest({
          id: `input-${v4()}`,
          operation: {
            type: 'input',
            pid,
            data: chunk,
          },
        });
      },
    });

    return {
      input: inputStream,
      output: outputStream,
      exit,
      resize: async (dimensions: { cols: number; rows: number }) => {
        await this._connection.sendRequest({
          id: `resize-${v4()}`,
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
    const process = await this.spawn('/bin/zsh', ['--interactive', ...args], {
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    const input = process.input;
    let output: ReadableStream<string>;
    let internalOutput: ReadableStream<string> | undefined;
    let executeCommand: ((command: string) => Promise<ExecutionResult>) | undefined;

    // Advanced feature: Wait for OSC code and command execution
    const waitTillOscCode = async (waitCode: string) => {
      let fullOutput = '';
      let exitCode = 0;
      let buffer = '';

      if (!internalOutput) {
        return { output: fullOutput, exitCode };
      }

      const reader = internalOutput.getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          const text = value || '';
          fullOutput += text;
          buffer += text;

          const matches = [...buffer.matchAll(/\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/g)];

          if (matches.length === 0) {
            if (buffer.length > 10000) {
              buffer = buffer.slice(-5000);
            }

            continue;
          }

          for (const match of matches) {
            const [fullMatch, osc, , , code] = match;

            if (osc === 'exit') {
              exitCode = parseInt(code || '0', 10);
            }

            if (osc === waitCode) {
              const matchIndex = buffer.indexOf(fullMatch);

              if (matchIndex !== -1) {
                buffer = buffer.slice(matchIndex + fullMatch.length);
              }

              return { output: fullOutput, exitCode };
            }
          }

          const lastMatch = matches[matches.length - 1][0];
          const lastMatchIndex = buffer.lastIndexOf(lastMatch);

          if (lastMatchIndex !== -1) {
            buffer = buffer.slice(lastMatchIndex + lastMatch.length);
          }
        }
      } finally {
        reader.releaseLock();
      }

      return { output: fullOutput, exitCode };
    };

    if (options.splitOutput) {
      const streams = process.output.tee();

      output = streams[0];
      internalOutput = streams[1];

      // Command execution implementation
      executeCommand = async (command: string): Promise<ExecutionResult> => {
        // Interrupt current execution
        terminal.input('\x03');

        // Wait for prompt
        await waitTillOscCode('prompt');

        // Execute new command
        terminal.input(command.trim() + '\n');

        // Wait for execution result
        const { output, exitCode } = await waitTillOscCode('exit');

        return {
          output: cleanTerminalOutput(output),
          exitCode,
        };
      };
    } else {
      output = process.output;
      internalOutput = undefined;
      executeCommand = undefined;
    }

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
      const writer = input.getWriter();
      writer.write(data);
      writer.releaseLock();
    });

    // Return basic shell session
    const session: ShellSession = {
      process,
      input,
      output,
      internalOutput,
      ready: shellReady.promise,
      executeCommand,
      waitTillOscCode,
    };

    return session;
  }

  close() {
    this._connection.close();
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
      const token = options.coep === 'credentialless' ? 'credentialless' : '';
      let machineId = '';

      if (token) {
        const response = await fetch(`https://${this._serverUrl}/api/machine`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        const data = (await response.json()) as { machine_id?: string };
        console.log('machine_id', data);

        if (data.machine_id) {
          machineId = data.machine_id;
        }
      }

      // Create remote container instance
      const container = new RemoteContainer(`ws://${this._serverUrl}`, workdir, token, machineId);

      // Initialize connection
      await (container as any)._connection.connect();

      return container;
    } catch (error) {
      console.error('Failed to boot remote container:', error);
      throw error;
    }
  }
}
