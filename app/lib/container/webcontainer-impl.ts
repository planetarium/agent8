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
  ExecutionResult,
} from './interfaces';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from '~/utils/promises';
import { cleanTerminalOutput } from '~/utils/shell';

/**
 * WebContainer file system implementation
 */
export class WebContainerFileSystem implements FileSystem {
  constructor(
    private _nativeFs: FileSystemAPI,
    private _wc: WebContainer,
  ) {}

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

      // Directly implement the Container interface instead of using an adapter
      return {
        fs: new WebContainerFileSystem(container.fs, container),
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
        on(event: 'port' | 'server-ready' | 'preview-message' | 'error', listener: any) {
          return (container as any).on(event, listener);
        },
        spawnShell: async (terminal: ITerminal, options: ShellOptions = {}): Promise<ShellSession> => {
          const args: string[] = options.args || [];

          // Create process
          const process = await container.spawn('/bin/jsh', ['--osc', ...args], {
            terminal: {
              cols: terminal.cols ?? 80,
              rows: terminal.rows ?? 15,
            },
          });

          const input = process.input.getWriter();
          let output = process.output;
          let internalOutput: ReadableStream<string> | undefined;

          // Split output streams (BoltShell functionality)
          if (options.splitOutput) {
            const [internal, termOut] = process.output.tee();
            output = termOut;
            internalOutput = internal;
          }

          const jshReady = withResolvers<void>();

          // Detect interactive mode
          let isInteractive = false;
          output.pipeTo(
            new WritableStream({
              write(data) {
                if (!isInteractive && options.interactive !== false) {
                  const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

                  if (osc === 'interactive') {
                    isInteractive = true;
                    jshReady.resolve();
                  }
                }

                terminal.write(data);
              },
            }),
          );

          // Handle terminal input
          terminal.onData((data) => {
            if (isInteractive) {
              input.write(data);
            }
          });

          // Advanced feature: Wait for OSC code and command execution
          const waitTillOscCode = async (waitCode: string) => {
            let fullOutput = '';
            let exitCode = 0;

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

                // Check for command completion signal and exit code
                const [, osc, , , code] = text.match(/\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/) || [];

                if (osc === 'exit') {
                  exitCode = parseInt(code, 10);
                }

                if (osc === waitCode) {
                  break;
                }
              }
            } finally {
              reader.releaseLock();
            }

            return { output: fullOutput, exitCode };
          };

          // Implement command execution functionality
          const executeCommand = async (command: string): Promise<ExecutionResult> => {
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

          // Construct session object
          const session: ShellSession = {
            process,
            input,
            output,
            ready: jshReady.promise,
          };

          // Add enhanced features only if needed
          if (internalOutput) {
            session.internalOutput = internalOutput;
            session.waitTillOscCode = waitTillOscCode;
            session.executeCommand = executeCommand;
          }

          // Wait for interactive mode activation
          if (options.interactive !== false) {
            await jshReady.promise;
          }

          return session;
        },
      };
    } catch (error) {
      console.error('WebContainer boot failed:', error);
      throw error;
    }
  }
}
