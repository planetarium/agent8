import type { Container } from '~/lib/container/interfaces';
import { path as nodePath } from '~/utils/path';
import { atom, map, type MapStore } from 'nanostores';
import type { ActionAlert, BoltAction, FileHistory } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import type { BoltShell } from '~/utils/shell';

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

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

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
      this.#updateAction(actionId, { status: 'running' });
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

    if (isStreaming && action.type !== 'file') {
      return; // No return value here
    }

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

    try {
      // Read current file content
      let currentContent = (await container.fs.readFile(relativePath, 'utf-8')) as string;
      const originalFileSize = Buffer.byteLength(currentContent, 'utf-8');

      // Parse the modify instructions from action.content
      const modifications = this.#parseModifications(action.content);

      // Calculate total size of modifications
      const modificationsSize = modifications.reduce((total, mod) => {
        const findLength = Buffer.byteLength(mod.find, 'utf-8');
        return total + findLength + Buffer.byteLength(mod.replace, 'utf-8');
      }, 0);

      logger.info(`📝 [Modify] Found ${modifications.length} modification(s) to apply`);
      logger.info(`📊 [Modify] Modifications size: ${modificationsSize} bytes (find+replace text only)`);

      // Apply each modification in order
      for (let i = 0; i < modifications.length; i++) {
        const mod = modifications[i];
        logger.debug(`🔍 [Modify] Applying modification ${i + 1}/${modifications.length}`);

        // Check if the text to find exists
        if (!currentContent.includes(mod.find)) {
          // Try with decoded HTML entities as a fallback
          const decodedFind = this.#decodeHtmlEntities(mod.find);
          const decodedReplace = this.#decodeHtmlEntities(mod.replace);

          if (decodedFind !== mod.find && currentContent.includes(decodedFind)) {
            logger.warn(`⚠️ [Modify] HTML entities detected and auto-corrected`);
            logger.warn(`Original find:\n"${mod.find}"`);
            logger.warn(`Decoded to:\n"${decodedFind}"`);
            logger.warn(`IMPORTANT: Please use actual characters instead of HTML entities in your code!`);

            // Use decoded versions
            mod.find = decodedFind;
            mod.replace = decodedReplace;
          } else {
            logger.error(`❌ [Modify] Could not find text in ${relativePath}:`);
            logger.error(`Looking for:\n"${mod.find}"`);
            logger.error(`Replace with:\n"${mod.replace}"`);

            // If decoded version is different, suggest it might be the issue
            if (decodedFind !== mod.find) {
              logger.error(`Note: The text contains HTML entities. Did you mean:\n"${decodedFind}"?`);
            }

            throw new Error(`Text not found in file: ${mod.find.substring(0, 50)}...`);
          }
        }

        // Replace the text
        const beforeLength = currentContent.length;

        // Check if text appears multiple times
        const occurrences = (
          currentContent.match(new RegExp(mod.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
        ).length;

        if (occurrences > 1) {
          logger.warn(`⚠️ [Modify] Text appears ${occurrences} times in file. Only first occurrence will be replaced.`);
        }

        currentContent = currentContent.replace(mod.find, mod.replace);

        const afterLength = currentContent.length;

        logger.debug(`🔍 [Modify] Replaced\nfind:\n"${mod.find}"\nreplace:\n"${mod.replace}"`);
        logger.debug(`✅ [Modify] Replacement ${i + 1} successful (${afterLength - beforeLength} chars changed)`);
      }

      // Write the updated content back
      await container.fs.writeFile(relativePath, currentContent);

      // Calculate final file size and savings
      const finalFileSize = Buffer.byteLength(currentContent, 'utf-8');
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

  #parseModifications(content: string): Array<{ find: string; replace: string }> {
    const modifications: Array<{ find: string; replace: string }> = [];

    // Match all <modify> blocks
    const modifyRegex = /<modify>([\s\S]*?)<\/modify>/g;
    let match;

    while ((match = modifyRegex.exec(content)) !== null) {
      const modifyContent = match[1];

      // Extract find and replace content
      const findMatch = modifyContent.match(/<find>([\s\S]*?)<\/find>/);
      const replaceMatch = modifyContent.match(/<replace>([\s\S]*?)<\/replace>/);

      if (findMatch && replaceMatch) {
        modifications.push({
          find: findMatch[1].trim(),
          replace: replaceMatch[1].trim(),
        });
      }
    }

    // If no <modify> tags found, try to parse as a simple find/replace
    if (modifications.length === 0 && content.includes('<find>') && content.includes('<replace>')) {
      const findMatch = content.match(/<find>([\s\S]*?)<\/find>/);
      const replaceMatch = content.match(/<replace>([\s\S]*?)<\/replace>/);

      if (findMatch && replaceMatch) {
        modifications.push({
          find: findMatch[1].trim(),
          replace: replaceMatch[1].trim(),
        });
      }
    }

    return modifications;
  }

  #decodeHtmlEntities(text: string): string {
    // Decode common HTML entities that LLM might incorrectly use
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x3D;/g, '=')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'");
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
