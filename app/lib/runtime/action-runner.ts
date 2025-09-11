import type { Container } from '~/lib/container/interfaces';
import { path as nodePath } from '~/utils/path';
import { atom, map, type MapStore } from 'nanostores';
import type { ActionAlert, BoltAction, FileHistory } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import type { BoltShell } from '~/utils/shell';
import { extractFromCDATA } from '~/utils/stringUtils';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

class ActionCommandError extends Error {
  readonly _output: string;
  readonly _header: string;

  constructor(message: string, output: string) {
    // Create a formatted message that includes both the error message and output
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    // Set the output separately so it can be accessed programmatically
    this._header = message;
    this._output = output;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ActionCommandError.prototype);

    // Set the name of the error for better debugging
    this.name = 'ActionCommandError';
  }

  // Optional: Add a method to get just the terminal output
  get output() {
    return this._output;
  }
  get header() {
    return this._header;
  }
}

export class ActionRunner {
  #container: Promise<Container>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: () => BoltShell;
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});
  onAlert?: (alert: ActionAlert) => void;
  onComplete?: () => void;
  #pendingActionsCount = 0;
  #envFileCreated = false;
  buildOutput?: { path: string; exitCode: number; output: string };
  #completeCalled = false;

  constructor(
    containerPromise: Promise<Container>,
    getShellTerminal: () => BoltShell,
    onAlert?: (alert: ActionAlert) => void,
    onComplete?: () => void,
  ) {
    this.#container = containerPromise;
    this.#shellTerminal = getShellTerminal;
    this.onAlert = onAlert;
    this.onComplete = onComplete;
  }

  isRunning() {
    return this.#pendingActionsCount > 0;
  }

  resetPendingActionsCount() {
    this.#pendingActionsCount = 0;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    logger.debug(`#### add action (${actionId}), type: ${data.action.type}`);

    this.#pendingActionsCount++;
    this.#completeCalled = false;

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      const action = this.actions.get()[actionId];

      if (action && action.status === 'pending') {
        this.#updateAction(actionId, { status: 'running' });
      }
    });
  }

  async runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return; // No return value here
    }

    if (isStreaming) {
      return; // No return value here
    }

    logger.debug(`#### runAction (${actionId}), type: ${action.type}`);

    this.#updateAction(actionId, { ...action, ...data.action, executed: !isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, isStreaming);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      })
      .finally(() => {
        this.#checkAllActionsCompleted();
      });

    await this.#currentExecutionPromise;

    return;
  }

  markActionAsRunning(actionId: string) {
    this.#updateAction(actionId, { status: 'running' });
  }

  async #executeAction(actionId: string, isStreaming: boolean = false) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'modify': {
          await this.#runModifyAction(action);
          break;
        }
        case 'build': {
          const buildOutput = await this.#runBuildAction(action);

          // Store build output for deployment
          this.buildOutput = buildOutput;
          break;
        }
        case 'start': {
          // making the start app non blocking

          this.#runStartAction(action)
            .then(() => {
              this.#updateAction(actionId, { status: 'complete' });
              this.#decrementPendingActionsCount();
            })
            .catch((err: Error) => {
              if (action.abortSignal.aborted) {
                return;
              }

              this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
              logger.error(`[${action.type}]:Action failed\n\n`, err);

              if (!(err instanceof ActionCommandError)) {
                return;
              }

              this.onAlert?.({
                type: 'error',
                title: 'Dev Server Failed',
                description: err.header,
                content: err.output,
              });

              this.#decrementPendingActionsCount();
            });

          /*
           * adding a delay to avoid any race condition between 2 start actions
           * i am up for a better approach
           */
          await new Promise((resolve) => setTimeout(resolve, 2000));

          return;
        }
      }

      this.#updateAction(actionId, {
        status: isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });

      if (!isStreaming) {
        this.#decrementPendingActionsCount();
      }
    } catch (error) {
      if (action.abortSignal.aborted) {
        return;
      }

      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(`[${action.type}]:Action failed\n\n`, error);

      if (!(error instanceof ActionCommandError)) {
        return;
      }

      this.onAlert?.({
        type: 'error',
        title: 'Dev Server Failed',
        description: error.header,
        content: error.output,
      });

      this.#decrementPendingActionsCount();

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  #decrementPendingActionsCount() {
    this.#pendingActionsCount = Math.max(0, this.#pendingActionsCount - 1);
    this.#checkAllActionsCompleted();
  }

  #checkAllActionsCompleted() {
    if (this.#pendingActionsCount === 0 && this.onComplete && !this.#completeCalled) {
      this.#completeCalled = true;

      // All actions have completed
      this.onComplete();
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const shell = this.#shellTerminal();
    await shell.ready;

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      logger.warn(`Failed To Execute Shell Command content: ${action.content}`);
      throw new ActionCommandError(`Failed To Execute Shell Command`, resp?.output || 'No Output Available');
    }
  }

  async #runStartAction(action: ActionState) {
    if (action.type !== 'start') {
      unreachable('Expected shell action');
    }

    if (!this.#shellTerminal) {
      unreachable('Shell terminal not found');
    }

    const shell = this.#shellTerminal();
    await shell.ready;

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      throw new ActionCommandError('Failed To Start Application', resp?.output || 'No Output Available');
    }

    return resp;
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const container = await this.#container;
    const relativePath = nodePath.relative(container.workdir, action.filePath);

    let folder = nodePath.dirname(relativePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await container.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await container.fs.writeFile(relativePath, action.content);
      logger.debug(`File written ${relativePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
    }
  }

  async #runModifyAction(action: ActionState) {
    if (action.type !== 'modify') {
      unreachable('Expected modify action');
    }

    const container = await this.#container;
    const relativePath = nodePath.relative(container.workdir, action.filePath);

    logger.info(`✏️ [Modify] Starting modifications for: ${relativePath}`);
    logger.info(`✏️ [Modify] raw content:\n${action.content}`);

    try {
      // Read current file content
      let currentFileContent = (await container.fs.readFile(relativePath, 'utf-8')) as string;
      const originalFileSize = Buffer.byteLength(currentFileContent, 'utf-8');

      // Extract the JSON content from CDATA if present
      const jsonContent = extractFromCDATA(action.content.trim());

      // Calculate total size of modifications
      const modificationsSize = Buffer.byteLength(jsonContent, 'utf-8');

      // Parse the modify instructions from action.content
      const modifications = this.#parseModifications(jsonContent);

      logger.info(`📝 [Modify] Found ${modifications.length} modification(s) to apply`);

      // Apply each modification in order
      for (let i = 0; i < modifications.length; i++) {
        const mod = modifications[i];
        logger.debug(`🔍 [Modify] Applying modification ${i + 1}/${modifications.length}`);

        // Check if the text to find exists
        if (!currentFileContent.includes(mod.before)) {
          throw new Error(`Text not found in file: ${mod.before}`);
        }

        // Check if text appears multiple times
        const occurrences = (
          currentFileContent.match(new RegExp(mod.before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
        ).length;

        if (occurrences > 1) {
          logger.warn(`⚠️ [Modify] Text appears ${occurrences} times in file. Only first occurrence will be replaced.`);
        }

        currentFileContent = currentFileContent.replace(mod.before, mod.after);

        logger.debug(`🔍 [Modify] Replaced\nbefore:\n"${mod.before}"\n-----------------------\nafter:\n"${mod.after}"`);
        logger.debug(`✅ [Modify] Replacement ${i + 1} successful`);
      }

      // Write the updated content back
      await container.fs.writeFile(relativePath, currentFileContent);

      // Calculate final file size and savings
      const finalFileSize = Buffer.byteLength(currentFileContent, 'utf-8');
      const savedBytes = finalFileSize - modificationsSize;
      const savingsPercentage = ((savedBytes / finalFileSize) * 100).toFixed(1);

      logger.info(`✅ [Modify] Successfully applied ${modifications.length} modification(s) to: ${relativePath}`);
      logger.info(`📊 [Modify] File size comparison:`);
      logger.info(`   - Original file: ${originalFileSize} bytes`);
      logger.info(`   - Final file: ${finalFileSize} bytes`);
      logger.info(`   - Modifications sent: ${modificationsSize} bytes`);
      logger.info(`   - Bytes saved: ${savedBytes} bytes (${savingsPercentage}% savings vs sending full file)`);
    } catch (error) {
      logger.error(`❌ [Modify] Failed to apply modifications to ${relativePath}:`, error);
    }
  }

  #unescapeString(content: string): string {
    return content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  #parseModifications(content: string): Array<{ before: string; after: string }> {
    const modifications: Array<{ before: string; after: string }> = [];

    try {
      // Parse the JSON
      const parsed = JSON.parse(content);

      // Ensure it's an array
      const modArray = Array.isArray(parsed) ? parsed : [parsed];

      // Process each modification
      for (const mod of modArray) {
        if (mod && typeof mod === 'object' && 'before' in mod && 'after' in mod) {
          modifications.push({
            before: String(mod.before),
            after: String(mod.after),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to parse JSON:', error);
      logger.debug('Raw content:\n', content);

      // fallback to regex if json parsing fails
      const regex = /"before"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"after"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      const reverseRegex = /"after"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"before"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        modifications.push({
          before: this.#unescapeString(match[1]),
          after: this.#unescapeString(match[2]),
        });
      }

      while ((match = reverseRegex.exec(content)) !== null) {
        modifications.push({
          before: this.#unescapeString(match[2]),
          after: this.#unescapeString(match[1]),
        });
      }
    }

    return modifications;
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    try {
      const container = await this.#container;
      const historyPath = this.#getHistoryPath(filePath);
      const content = (await container.fs.readFile(historyPath, 'utf-8')) as string;

      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to get file history:', error);
      return null;
    }
  }

  async saveFileHistory(filePath: string, history: FileHistory) {
    const historyPath = this.#getHistoryPath(filePath);

    await this.#runFileAction({
      type: 'file',
      filePath: historyPath,
      content: JSON.stringify(history),
      changeSource: 'auto-save',
    } as any);
  }

  #getHistoryPath(filePath: string) {
    return nodePath.join('.history', filePath);
  }

  async #runBuildAction(action: ActionState) {
    if (action.type !== 'build') {
      unreachable('Expected build action');
    }

    const container = await this.#container;

    // Create a new terminal specifically for the build
    const buildProcess = await container.spawn('npm', ['run', 'build']);

    let output = '';
    buildProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          output += data;
        },
      }),
    );

    const exitCode = await buildProcess.exit;

    if (exitCode !== 0) {
      throw new ActionCommandError('Build Failed', output || 'No Output Available');
    }

    // Get the build output directory path
    const buildDir = nodePath.join(container.workdir, 'dist');

    return {
      path: buildDir,
      exitCode,
      output,
    };
  }
}
