import type { Container, ExecutionResult, ShellSession } from '~/lib/container/interfaces';
import type { ITerminal } from '~/types/terminal';
import { atom } from 'nanostores';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('BoltShell');

const PROCESS_STATUS_CHECK_TIMEOUT_MS = 100;
const TERMINAL_READY_PROMPT_DELAY_MS = 200;

export class BoltShell {
  #initialized: (() => void) | undefined;
  #readyPromise: Promise<void>;
  #container: Container | undefined;
  #terminal: ITerminal | undefined;
  #shellSession: ShellSession | undefined;
  executionState = atom<
    { sessionId: string; active: boolean; executionPrms?: Promise<any>; abort?: () => void } | undefined
  >();

  constructor() {
    this.#readyPromise = new Promise((resolve) => {
      this.#initialized = resolve;
    });
  }

  get ready() {
    return this.#readyPromise;
  }

  get isInit() {
    return !!this.#container;
  }

  get process() {
    return this.#shellSession?.process;
  }

  get terminal() {
    return this.#terminal;
  }

  async init(container: Container, terminal: ITerminal) {
    // Check if existing session is valid and can be reused
    if (this.#container === container && this.#shellSession && this.#terminal) {
      logger.debug('BoltShell: Checking existing session validity...');

      const isValid = await this._isSessionValid();

      if (isValid) {
        logger.debug('BoltShell: ✅ Reusing existing session - process still alive');

        // Only replace terminal reference if different
        if (this.#terminal !== terminal) {
          logger.debug('BoltShell: Updating terminal reference and reattaching streams');
          this.#terminal = terminal;

          // Reattach terminal streams to the new terminal
          if (this.#shellSession.attachTerminal) {
            await this.#shellSession.attachTerminal(terminal);
            logger.debug('BoltShell: Terminal streams successfully reattached');
          } else {
            logger.warn('BoltShell: Terminal reattachment not supported by this session');
          }
        } else {
          logger.debug('BoltShell: Terminal reference unchanged');
        }

        this.#initialized?.();
        logger.debug('BoltShell: Session reuse completed successfully');

        return;
      } else {
        logger.debug('BoltShell: ❌ Existing session is invalid, creating new session');
      }
    }

    // Clean up existing session if any
    if (this.#shellSession) {
      logger.debug('BoltShell: Cleaning up existing session');
      this.detachTerminal();
    }

    this.#container = container;
    this.#terminal = terminal;

    logger.debug('BoltShell: 🔄 Creating new session...');
    this.#shellSession = await container.spawnShell(terminal, { splitOutput: true });
    logger.debug('BoltShell: Waiting for shell session to be ready...');
    await this.#shellSession.ready;
    this.#initialized?.();
    logger.debug('BoltShell: ✅ New session created and initialized successfully');

    // Send a newline to display initial prompt
    setTimeout(() => {
      if (this.#terminal) {
        logger.debug('BoltShell: Sending newline to display initial prompt');
        this.#terminal.input('\n');
      }
    }, TERMINAL_READY_PROMPT_DELAY_MS);
  }

  async executeCommand(sessionId: string, command: string, abort?: () => void): Promise<ExecutionResult | undefined> {
    if (!this.process || !this.terminal) {
      return undefined;
    }

    const state = this.executionState.get();

    if (state?.active && state.abort) {
      state.abort();
    }

    // Utilize advanced features from container API
    if (this.#container && this.#terminal) {
      if (this.#shellSession?.executeCommand) {
        // Use the pre-implemented executeCommand function
        const executionPromise = this.#shellSession.executeCommand(command);
        this.executionState.set({ sessionId, active: true, executionPrms: executionPromise, abort });

        const resp = await executionPromise;
        this.executionState.set({ sessionId, active: false });

        return resp;
      } else {
        throw new Error('BoltShell does not support executeCommand');
      }
    } else {
      throw new Error('BoltShell is not initialized');
    }
  }

  async newBoltShellProcess(container: Container, terminal: ITerminal) {
    const shellSession = await container.spawnShell(terminal, { splitOutput: true });

    return {
      process: shellSession.process,
      output: shellSession.internalOutput!,
    };
  }

  async getCurrentExecutionResult(): Promise<ExecutionResult> {
    const { output, exitCode } = await this.waitTillOscCode('exit');
    return { output, exitCode };
  }

  async waitTillOscCode(waitCode: string) {
    if (this.#shellSession && this.#shellSession.waitTillOscCode) {
      return await this.#shellSession.waitTillOscCode(waitCode);
    } else {
      throw new Error('BoltShell does not support waitTillOscCode');
    }
  }

  detachTerminal() {
    if (this.#shellSession && this.#shellSession.detachTerminal) {
      this.#shellSession.detachTerminal();
    }
  }

  private async _isSessionValid(): Promise<boolean> {
    if (!this.#container || !this.#shellSession || !this.#terminal) {
      logger.debug('BoltShell: Session validation failed - missing components');
      return false;
    }

    try {
      // Check if process is still alive by racing against the exit promise
      const processStatus = await Promise.race([
        this.#shellSession.process.exit.then(() => 'dead' as const),
        new Promise<'alive'>((resolve) => setTimeout(() => resolve('alive'), PROCESS_STATUS_CHECK_TIMEOUT_MS)),
      ]);

      logger.debug(`BoltShell: Process status check result: ${processStatus}`);

      return processStatus === 'alive';
    } catch (error) {
      logger.debug('BoltShell: Session validation error:', error);
      return false;
    }
  }
}

/**
 * Cleans and formats terminal output while preserving structure and paths
 * Handles ANSI, OSC, and various terminal control sequences
 */
export function cleanTerminalOutput(input: string): string {
  // Step 1: Remove OSC sequences (including those with parameters)
  const removeOsc = input
    .replace(/\x1b\](\d+;[^\x07\x1b]*|\d+[^\x07\x1b]*)\x07/g, '')
    .replace(/\](\d+;[^\n]*|\d+[^\n]*)/g, '');

  // Step 2: Remove ANSI escape sequences and color codes more thoroughly
  const removeAnsi = removeOsc
    // Remove all escape sequences with parameters
    .replace(/\u001b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    // Remove color codes
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Clean up any remaining escape characters
    .replace(/\u001b/g, '')
    .replace(/\x1b/g, '');

  // Step 3: Clean up carriage returns and newlines
  const cleanNewlines = removeAnsi
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Step 4: Add newlines at key breakpoints while preserving paths
  const formatOutput = cleanNewlines
    // Preserve prompt line
    .replace(/^([~\/][^\n❯]+)❯/m, '$1\n❯')
    // Add newline before command output indicators
    .replace(/(?<!^|\n)>/g, '\n>')
    // Add newline before error keywords without breaking paths
    .replace(/(?<!^|\n|\w)(error|failed|warning|Error|Failed|Warning):/g, '\n$1:')
    // Add newline before 'at' in stack traces without breaking paths
    .replace(/(?<!^|\n|\/)(at\s+(?!async|sync))/g, '\nat ')
    // Ensure 'at async' stays on same line
    .replace(/\bat\s+async/g, 'at async')
    // Add newline before npm error indicators
    .replace(/(?<!^|\n)(npm ERR!)/g, '\n$1');

  // Step 5: Clean up whitespace while preserving intentional spacing
  const cleanSpaces = formatOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // Step 6: Final cleanup
  return cleanSpaces
    .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/:\s+/g, ': ') // Normalize spacing after colons
    .replace(/\s{2,}/g, ' ') // Remove multiple spaces
    .replace(/^\s+|\s+$/g, '') // Trim start and end
    .replace(/\u0000/g, ''); // Remove null characters
}

export function newBoltShellProcess() {
  return new BoltShell();
}
