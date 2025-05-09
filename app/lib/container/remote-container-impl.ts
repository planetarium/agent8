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
import { createScopedLogger } from '~/utils/logger';

// Constants for OSC parsing
const OSC_PATTERNS = {
  createWaitCodeRegex: (waitCode: string) => new RegExp(`\\x1b\\]654;${waitCode}=?((-?\\d+):(\\d+))?\\x07`, 'g'),
  EXIT_CODE_REGEX: /\x1b\]654;exit=?((-?\d+):(\d+))?\x07/g,
  ALL_OSC_REGEX: /\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/g,
};

// Buffer size configuration
const BUFFER_CONFIG = {
  MAX_GLOBAL_SIZE: 20000,
  TRUNCATED_GLOBAL_SIZE: 10000,
  MAX_LOCAL_SIZE: 10000,
  TRUNCATED_LOCAL_SIZE: 5000,
};

const ROUTER_DOMAIN = 'agent8.verse8.net';
const CONTAINER_AGENT_PROTOCOL = 'agent8-container-v1';
const logger = createScopedLogger('remote-container');

function base64ToUint8Array(base64: string) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } else {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }
}

/**
 * Class to manage remote WebSocket connection and communication
 */
class RemoteContainerConnection {
  private _ws: WebSocket | null = null;
  private _requestMap = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void }>();
  private _connected = false;
  private _connectionPromise: Promise<void> | null = null;
  private _lastRequestTime = Date.now();
  private _heartbeatInterval: NodeJS.Timeout | null = null;
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
  ) {}

  private _startHeartbeat(interval: number = 10000) {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
    }

    this._heartbeatInterval = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        const timeSinceLastRequest = Date.now() - this._lastRequestTime;

        if (timeSinceLastRequest >= interval) {
          this.sendRequest({
            id: `heartbeat-${v4()}`,
            operation: {
              type: 'heartbeat',
            },
          });
        }
      }
    }, interval);
  }

  private _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

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
      this._ws = new WebSocket(this._serverUrl, [CONTAINER_AGENT_PROTOCOL]);

      this._ws.onopen = () => {
        this._connected = true;
        this._startHeartbeat();

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
          logger.error('Remote container message parsing error:', err);
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
        this._stopHeartbeat();
        logger.warn('Remote container connection closed');
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
      this._lastRequestTime = Date.now();
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
            listener(message.data.watcherId, message.data.eventType, message.data.filename, message.data.buffer),
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
      logger.warn('unregistered event:', 'on', event, listener.toString());
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
      .catch((err) => {
        logger.error('Failed to watch file:', err);
      });

    const connection = this._connection;
    const unsubscribers: Unsubscribe[] = [];

    return {
      addEventListener(event: string, listener) {
        const unsubscribe = connection.on('file-change', (watcherId, eventType, filename, buffer) => {
          if (watcherId === watcherIdFromResponse) {
            listener(eventType, filename, buffer ? base64ToUint8Array(buffer) : null);
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
      .catch((err) => {
        logger.error('Failed to watch paths:', err);
      });

    this._connection.on('file-change', (watcherId, eventType, filename, buffer) => {
      if (watcherId === watcherIdFromResponse) {
        callback([{ type: eventType as any, path: filename, buffer: buffer ? base64ToUint8Array(buffer) : undefined }]);
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

  private _connection: RemoteContainerConnection;

  constructor(serverUrl: string, workdir: string, token: string) {
    this._connection = new RemoteContainerConnection(serverUrl, token);
    this.fs = new RemoteContainerFileSystem(this._connection);
    this.workdir = workdir;
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
      env: {
        __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: `.${ROUTER_DOMAIN}`,
      },
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    const input = process.input;
    let output: ReadableStream<string>;
    let internalOutput: ReadableStream<string> | undefined;
    let executeCommand: ((command: string) => Promise<ExecutionResult>) | undefined;

    const waitInternalOutputLock = async () => {
      if (!internalOutput) {
        return;
      }

      while (internalOutput.locked) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    let _globalOutputBuffer: string = '';

    // Extracts exit code from output text
    const extractExitCode = (text: string): number => {
      const exitMatches = [...text.matchAll(OSC_PATTERNS.EXIT_CODE_REGEX)];

      if (exitMatches.length > 0) {
        const [, , , exitCodeStr] = exitMatches[exitMatches.length - 1];
        return parseInt(exitCodeStr || '0', 10);
      }

      return 0;
    };

    // Process OSC match and potentially return result
    const processOscMatch = (
      match: RegExpMatchArray,
      osc: string,
      waitCode: string,
      fullOutput: string,
      exitCode: number,
    ): { result: { output: string; exitCode: number } | null; newExitCode: number } => {
      const [fullMatch] = match;
      let newExitCode = exitCode;

      if (osc === 'exit') {
        const [, , , code] = match;
        newExitCode = parseInt(code || '0', 10);
      }

      if (osc === waitCode) {
        const matchIndex = fullOutput.indexOf(fullMatch);

        if (matchIndex !== -1) {
          // Get output up to and including the OSC code
          const extractedOutput = fullOutput.substring(0, matchIndex + fullMatch.length);

          // Update the global buffer - remove the part we're returning
          const globalMatchIndex = _globalOutputBuffer.indexOf(fullMatch);

          if (globalMatchIndex !== -1) {
            _globalOutputBuffer = _globalOutputBuffer.substring(globalMatchIndex + fullMatch.length);
          }

          return {
            result: { output: extractedOutput, exitCode: newExitCode },
            newExitCode,
          };
        }
      }

      return { result: null, newExitCode };
    };

    const waitTillOscCode = async (waitCode: string) => {
      let fullOutput = '';
      let exitCode = 0;

      if (!internalOutput) {
        throw new Error('No internal output stream');
      }

      // Create regex for the requested OSC code
      const oscRegex = OSC_PATTERNS.createWaitCodeRegex(waitCode);

      // Check if the requested OSC code is already in the global buffer
      const bufferMatches = [..._globalOutputBuffer.matchAll(oscRegex)];

      /*
       * If not found in buffer, read from the stream
       * Do not move this awaiting after existing buffer check, as there may be existing awaiters.
       */
      await waitInternalOutputLock();

      if (bufferMatches.length > 0) {
        // Found the OSC code in the buffer, extract output up to this code
        const match = bufferMatches[0];
        const [fullMatch] = match;
        const matchIndex = _globalOutputBuffer.indexOf(fullMatch);

        if (matchIndex !== -1) {
          // Get output up to and including the OSC code
          fullOutput = _globalOutputBuffer.substring(0, matchIndex + fullMatch.length);

          // Trim the global buffer to remove the extracted part
          _globalOutputBuffer = _globalOutputBuffer.substring(matchIndex + fullMatch.length);

          // Look for exit code in the extracted output
          exitCode = extractExitCode(fullOutput);

          return { output: fullOutput, exitCode };
        }
      }

      const reader = internalOutput.getReader();
      let localBuffer = _globalOutputBuffer; // Start with existing buffer content

      try {
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          const text = value || '';
          fullOutput += text;
          localBuffer += text;
          _globalOutputBuffer += text; // Add to global buffer

          // Prevent buffer from growing too large
          if (_globalOutputBuffer.length > BUFFER_CONFIG.MAX_GLOBAL_SIZE) {
            _globalOutputBuffer = _globalOutputBuffer.slice(-BUFFER_CONFIG.TRUNCATED_GLOBAL_SIZE);
          }

          // Check for OSC codes in the updated buffer
          const matches = [...localBuffer.matchAll(OSC_PATTERNS.ALL_OSC_REGEX)];

          if (matches.length === 0) {
            if (localBuffer.length > BUFFER_CONFIG.MAX_LOCAL_SIZE) {
              localBuffer = localBuffer.slice(-BUFFER_CONFIG.TRUNCATED_LOCAL_SIZE);
            }

            continue;
          }

          // Process all matches
          for (const match of matches) {
            const [, osc] = match;
            const { result, newExitCode } = processOscMatch(match, osc, waitCode, fullOutput, exitCode);
            exitCode = newExitCode;

            if (result) {
              return result;
            }
          }

          // Update local buffer to contain only content after the last match
          const lastMatch = matches[matches.length - 1][0];
          const lastMatchIndex = localBuffer.lastIndexOf(lastMatch);

          if (lastMatchIndex !== -1) {
            localBuffer = localBuffer.slice(lastMatchIndex + lastMatch.length);
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
        logger.debug('executeCommand', command);

        // Interrupt current execution
        terminal.input('\x03');

        logger.debug('waiting for prompt', command);

        // Wait for prompt
        await waitTillOscCode('prompt');

        logger.debug('prompt received', command);

        // Execute new command
        terminal.input(command.trim() + '\n');

        logger.debug('command executed', command);

        // Wait for execution result
        const { output, exitCode } = await waitTillOscCode('exit');

        logger.debug('execution ended', command, exitCode);

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

    // Detect interactive mode
    let checkInteractive = false;
    output.pipeTo(
      new WritableStream({
        write(data) {
          if (!checkInteractive && options.interactive !== false) {
            const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

            if (osc === 'interactive') {
              checkInteractive = true;
              shellReady.resolve();
            }
          }

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
  constructor(
    private _serverUrl: string,
    private _appName: string,
  ) {}

  async boot(options: ContainerOptions): Promise<Container> {
    try {
      // For webcontainer compatibility
      const workdir = `/home/${options.workdirName}`;
      const v8AccessToken = options.v8AccessToken;

      if (!v8AccessToken) {
        throw new Error('No V8 access token given');
      }

      const response = await fetch(`https://${this._serverUrl}/api/machine`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${v8AccessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const machineId = ((await response.json()) as { machine_id?: string }).machine_id;

      if (machineId === undefined) {
        throw new Error('No machine ID received from server');
      }

      logger.info('Waiting for machine to be ready...');
      await this._waitForMachineReady(machineId, v8AccessToken);
      logger.info('Machine is ready');

      // Create remote container instance
      const container = new RemoteContainer(
        `wss://${this._appName}-${machineId}.${ROUTER_DOMAIN}`,
        workdir,
        v8AccessToken,
      );

      // Initialize connection
      try {
        await (container as any)._connection.connect();
        logger.info('Successfully connected to remote container');

        return container;
      } catch (error) {
        throw new Error(`Failed to connect to remote container: ${error}`);
      }
    } catch (error) {
      logger.error('Failed to boot remote container:', error);
      throw error;
    }
  }

  private async _waitForMachineReady(machineId: string, token: string): Promise<void> {
    const maxRetries = 30; // Maximum 30 attempts
    const delayMs = 2000; // Check every 2 seconds

    interface MachineResponse {
      success: boolean;
      machine?: {
        id: string;
        state: string;
        [key: string]: any;
      };
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`https://${this._serverUrl}/api/machine/${machineId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`API response error: ${response.status}`);
        }

        const data = (await response.json()) as MachineResponse;

        if (data.success && data.machine && data.machine.state === 'started') {
          return; // Machine is ready
        }

        logger.info(`Machine state: ${data.machine?.state || 'unknown'}, retrying...`);
      } catch (error) {
        logger.error(`Error checking machine status: ${error}`);
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Machine not ready. Maximum retry count exceeded');
  }
}
