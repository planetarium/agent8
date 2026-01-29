import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import type { Container } from '~/lib/container/interfaces';
import { ContainerFactory } from '~/lib/container/factory';
import { ERROR_NAMES, SHELL_COMMANDS, WORK_DIR, WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';
import { shouldIgnoreError } from '~/utils/errorFilters';
import { createScopedLogger } from '~/utils/logger';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap, type File } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import JSZip from 'jszip';
import fileSaver from 'file-saver';
import { path } from '~/utils/path';
import { extractRelativePath } from '~/utils/diff';
import { createSampler } from '~/utils/sampler';
import type { ActionAlert } from '~/types/actions';
import { repoStore } from './repo';
import {
  isEnabledGitbasePersistence,
  commitUserChanged,
  getLastCommitHash,
  getTags,
} from '~/lib/persistenceGitbase/api.client';
import { V8_ACCESS_TOKEN_KEY, verifyV8AccessToken, type V8User } from '~/lib/verse8/userAuth';
import { generateVerseId } from '~/utils/envUtils';
import type { BoltShell } from '~/utils/shell';
import { SETTINGS_KEYS } from './settings';
import { toast } from 'react-toastify';
import { isCommitedMessage } from '~/lib/persistenceGitbase/utils';
import { convertFileMapToFileSystemTree } from '~/utils/fileUtils';
import { DeployError, isAbortError, StatusCodeError } from '~/utils/errors';

const { saveAs } = fileSaver;

const logger = createScopedLogger('workbench');

function ensureUnsavedFilesSet(value: any): Set<string> {
  if (value instanceof Set) {
    return value;
  }

  if (Array.isArray(value)) {
    return new Set(value);
  }

  if (value && typeof value === 'object' && value.constructor === Object) {
    return new Set<string>(Object.keys(value));
  }

  return new Set<string>();
}

interface ActionQueueItem {
  data: ActionCallbackData;
  executeAction: () => void;
  next?: ActionQueueItem;
}

export interface ArtifactState {
  id: string;
  title: string;
  type?: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'diff' | 'preview' | 'resource';

export class WorkbenchStore {
  #currentContainer: Promise<Container>;
  #containerResolver!: (container: Container) => void;
  #containerRejecter!: (error: any) => void;
  #containerInitialized = false;

  #previewsStore: PreviewsStore;
  #filesStore: FilesStore;
  #editorStore: EditorStore;
  #terminalStore: TerminalStore;
  #messageCloseCallbacks: Map<string, Array<() => void>> = new Map();
  #messageIdleCallbacks: Map<string, Array<() => void>> = new Map();
  #reinitCounter = atom(0);
  #currentContainerAtom: WritableAtom<Container | null> = atom<Container | null>(null);
  #runPreviewAbortController: AbortController | null = null;
  #publishAbortController: AbortController | null = null;

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  unsavedFiles: WritableAtom<Set<string>> = atom(
    ensureUnsavedFilesSet(import.meta.hot?.data.unsavedFiles?.get?.() ?? import.meta.hot?.data.unsavedFiles),
  );
  actionAlert: WritableAtom<ActionAlert | undefined> =
    import.meta.hot?.data.actionAlert ?? atom<ActionAlert | undefined>(undefined);
  diffCommitHash: WritableAtom<string | null> = import.meta.hot?.data.diffCommitHash ?? atom<string | null>(null);
  diffEnabled: WritableAtom<boolean> = import.meta.hot?.data.diffEnabled ?? atom(false);
  connectionState: WritableAtom<'connected' | 'disconnected' | 'reconnecting' | 'failed'> =
    import.meta.hot?.data.connectionState ??
    atom<'connected' | 'disconnected' | 'reconnecting' | 'failed'>('disconnected');
  isRunningPreview: WritableAtom<boolean> = import.meta.hot?.data.isRunningPreview ?? atom(false);
  isDeploying: WritableAtom<boolean> = import.meta.hot?.data.isDeploying ?? atom(false);
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #messageToArtifactIds: Map<string, string[]> = new Map();
  #globalExecutionQueue = Promise.resolve();
  #connectionLostNotified = false;
  #messageToActionQueue: Map<string, ActionQueueItem | null> = new Map();
  #shellCommandQueue: Promise<any> = Promise.resolve();
  #shellAbortController: AbortController | null = null;

  // Container initialization state management
  #initializationState: 'idle' | 'initializing' | 'reinitializing' = 'idle';
  #initializationPromise: Promise<Container | null> | null = null;

  constructor() {
    this.#currentContainer = new Promise<Container>((resolve, reject) => {
      this.#containerResolver = resolve;
      this.#containerRejecter = reject;
    });

    this.#previewsStore = new PreviewsStore(this.#currentContainer);
    this.#filesStore = new FilesStore(this.#currentContainer);
    this.#editorStore = new EditorStore(this.#filesStore);
    this.#terminalStore = new TerminalStore(this.#currentContainer);

    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.actionAlert = this.actionAlert;
      import.meta.hot.data.diffCommitHash = this.diffCommitHash;
      import.meta.hot.data.diffEnabled = this.diffEnabled;
      import.meta.hot.data.connectionState = this.connectionState;
      import.meta.hot.data.isDeploying = this.isDeploying;

      if (import.meta.hot.data.workbenchContainer) {
        this.#currentContainer = import.meta.hot.data.workbenchContainer;
        this.#containerInitialized = true;
        logger.info('HMR: Container restored from hot data');
      } else {
        this.#currentContainer.then((container) => {
          if (import.meta.hot) {
            import.meta.hot.data.workbenchContainer = Promise.resolve(container);
          }
        });
      }
    }
  }

  async initializeContainer(accessToken: string): Promise<Container | null> {
    // Add debug logging
    logger.info(`🔍 initializeContainer called - current state: ${this.#initializationState}`);

    // Check if initialization is already in progress
    if (this.#initializationState !== 'idle') {
      logger.warn(`🚫 Container ${this.#initializationState} already in progress, waiting for completion...`);
      return this.#initializationPromise;
    }

    // Set state and create promise
    logger.info(`🚀 Starting container initialization...`);
    this.#initializationState = 'initializing';
    this.#initializationPromise = this.#doInitializeContainer(accessToken);

    try {
      const result = await this.#initializationPromise;
      logger.info(`✅ Container initialization completed successfully`);

      return result;
    } catch (error) {
      logger.error(`❌ Container initialization failed:`, error);
      throw error;
    } finally {
      // Reset state
      logger.info(`🔄 Resetting initialization state to idle`);
      this.#initializationState = 'idle';
      this.#initializationPromise = null;
    }
  }

  async #doInitializeContainer(accessToken: string): Promise<Container | null> {
    try {
      const containerPromise = ContainerFactory.create({
        coep: 'credentialless',
        workdirName: WORK_DIR_NAME,
        forwardPreviewErrors: true,
        v8AccessToken: accessToken,
      });

      const containerInstance = await containerPromise;

      this.#containerResolver(containerInstance);

      this.#setupContainerErrorHandling(containerInstance);
      this.#setupConnectionStateHandling(containerInstance);
      this.#containerInitialized = true;

      this.#currentContainerAtom.set(containerInstance);

      return containerInstance;
    } catch (error) {
      logger.error('Container initialization failed:', error);

      this.#containerRejecter(error);

      const alert = {
        type: 'preview',
        title: 'Container Initialization Failed',
        description: error instanceof Error ? error.message : String(error),
        content: `Failed to initialize container\n\nError: ${error instanceof Error ? error.stack : error}`,
        source: 'preview',
        status: error instanceof StatusCodeError ? error.status : undefined,
      } satisfies ActionAlert;

      if (!shouldIgnoreError(alert)) {
        this.actionAlert.set(alert);
      }

      return null;
    }
  }

  async reinitializeContainer(accessToken: string): Promise<Container | null> {
    // Add debug logging
    logger.info(`🔍 reinitializeContainer called - current state: ${this.#initializationState}`);

    // Check if any container operation is already in progress
    if (this.#initializationState !== 'idle') {
      logger.warn(`🚫 Container ${this.#initializationState} already in progress, waiting for completion...`);
      return this.#initializationPromise;
    }

    // Set state and create promise
    logger.info(`🚀 Starting container reinitialization...`);
    this.#initializationState = 'reinitializing';
    this.#initializationPromise = this.#doReinitializeContainer(accessToken);

    try {
      const result = await this.#initializationPromise;
      logger.info(`✅ Container reinitialization completed successfully`);

      return result;
    } catch (error) {
      logger.error(`❌ Container reinitialization failed:`, error);
      throw error;
    } finally {
      // Reset state
      logger.info(`🔄 Resetting reinitialization state to idle`);
      this.#initializationState = 'idle';
      this.#initializationPromise = null;
    }
  }

  async #doReinitializeContainer(accessToken: string): Promise<Container | null> {
    const isPromisePending = async (promise: Promise<any>): Promise<boolean> => {
      const pending = Symbol('pending');
      const result = await Promise.race([
        promise.then(
          () => false,
          () => false,
        ),
        Promise.resolve(pending),
      ]);

      return result === pending;
    };

    const isPending = await isPromisePending(this.#currentContainer);

    if (isPending && !this.#containerInitialized) {
      return this.#doInitializeContainer(accessToken);
    } else {
      logger.info('Forcing container reinitialization...');

      this.#currentContainer = new Promise<Container>((resolve, reject) => {
        this.#containerResolver = resolve;
        this.#containerRejecter = reject;
      });

      this.#terminalStore.detachTerminals();

      this.#previewsStore = new PreviewsStore(this.#currentContainer);
      this.#filesStore = new FilesStore(this.#currentContainer);
      this.#editorStore = new EditorStore(this.#filesStore);
      this.#terminalStore = new TerminalStore(this.#currentContainer);

      const currentUnsavedFiles = this.unsavedFiles.get();

      if (!(currentUnsavedFiles instanceof Set)) {
        logger.warn('unsavedFiles is not a Set during reinit, converting to Set');
        this.unsavedFiles.set(ensureUnsavedFilesSet(currentUnsavedFiles));
      }

      this.#containerInitialized = false;

      this.#reinitCounter.set(this.#reinitCounter.get() + 1);
      logger.info(`ReinitCounter increased to: ${this.#reinitCounter.get()}`);

      const containerResult = await this.#doInitializeContainer(accessToken);

      if (containerResult) {
        try {
          const currentFiles = this.#filesStore.files.get();

          if (Object.keys(currentFiles).length > 0) {
            logger.info('Mounting current file system to new container...');
            await containerResult.mount(convertFileMapToFileSystemTree(currentFiles));
            logger.info('File system successfully mounted to new container');
          }
        } catch (error) {
          logger.error('Failed to mount file system to new container:', error);
        }
      }

      return containerResult;
    }
  }

  get containerReady(): boolean {
    return this.#containerInitialized;
  }

  get initializationState(): 'idle' | 'initializing' | 'reinitializing' {
    return this.#initializationState;
  }

  get container(): Promise<Container> {
    return this.#currentContainer;
  }

  get reinitCounter() {
    return this.#reinitCounter;
  }

  get containerAtom() {
    return this.#currentContainerAtom;
  }

  #setupContainerErrorHandling(container: Container): void {
    container.on('preview-message', (message) => {
      logger.info('Preview message:', message);

      if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
        const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';

        const alert = {
          type: 'preview',
          title: isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception',
          description: message.message || 'An error occurred in the preview',
          content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
          source: 'preview',
        } satisfies ActionAlert;

        if (!shouldIgnoreError(alert)) {
          this.actionAlert.set(alert);
        }
      }
    });
  }

  #setupConnectionStateHandling(container: Container): void {
    container.on('connection-state', (state, prevState) => {
      logger.info(`Container connection state: ${prevState} → ${state}`);
      this.connectionState.set(state);

      if (state === 'disconnected' || state === 'failed') {
        this.#handleConnectionLost(state);
      } else if (state === 'connected') {
        this.#handleConnectionRestored();
      } else if (state === 'reconnecting') {
        this.#handleReconnecting();
      }
    });
  }

  #handleConnectionLost(state: string): void {
    if (this.#connectionLostNotified) {
      return;
    }

    this.#connectionLostNotified = true;
    logger.error('Connection lost:', state);
  }

  #handleConnectionRestored(): void {
    if (this.#connectionLostNotified) {
      this.#connectionLostNotified = false;
      toast.success('Connection restored');
    }
  }

  #handleReconnecting(): void {
    if (!this.#connectionLostNotified) {
      toast.info('Reconnecting...');
    }
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }

  get boltTerminal() {
    return this.#terminalStore.boltTerminal;
  }

  get alert() {
    return this.actionAlert;
  }

  clearAlert() {
    this.actionAlert.set(undefined);
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }

  attachBoltTerminal(terminal: ITerminal) {
    this.#terminalStore.attachBoltTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      // we find the first file and select it
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    this.setDocumentContentByPath(filePath, newContent);
  }

  setDocumentContentByPath(filePath: string, newContent: string) {
    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const previousUnsavedFiles = this.unsavedFiles.get();

    if (unsavedChanges && previousUnsavedFiles?.has(filePath)) {
      return;
    }

    const newUnsavedFiles = new Set(previousUnsavedFiles);

    if (unsavedChanges) {
      newUnsavedFiles.add(filePath);
    } else {
      newUnsavedFiles.delete(filePath);
    }

    this.unsavedFiles.set(newUnsavedFiles);
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value || '\n');

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }
  getModifiedFiles() {
    return this.#filesStore.getModifiedFiles();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  resetFiles() {
    this.#filesStore.files.set({});
    this.#filesStore.resetFileModifications();
  }

  abortAllActions() {
    // Process and clear all message action queues
    const queueSnapshot = new Map(this.#messageToActionQueue);
    this.#messageToActionQueue.clear();

    for (const queueItem of queueSnapshot.values()) {
      if (queueItem) {
        // Traverse the linked list and abort all actions
        let current: ActionQueueItem | undefined = queueItem;

        while (current) {
          // Get the artifact for this action
          const artifact = this.#getArtifact(current.data.artifactId);

          if (artifact) {
            // Abort pending/running actions in this artifact
            const actions = artifact.runner.actions.get();

            for (const [actionId, action] of Object.entries(actions)) {
              if (!action.executed && action.status !== 'complete') {
                action.abort?.();
                artifact.runner.actions.setKey(actionId, {
                  ...action,
                  status: 'aborted',
                  executed: true,
                });
              }
            }

            // Reset pending actions count for this artifact
            artifact.runner.resetPendingActionsCount();
          }

          // Clear the queue item
          current.executeAction = () => undefined;

          const next: ActionQueueItem | undefined = current.next;
          current.next = undefined;
          current = next;
        }
      }
    }

    this.#runPreviewAbortController?.abort();
    this.#publishAbortController?.abort();
    this.#shellAbortController?.abort();

    this.#runPreviewAbortController = null;
    this.#publishAbortController = null;
    this.#shellAbortController = null;

    this.#shellCommandQueue = Promise.resolve();
  }

  addArtifact({ messageId, title, id, type }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(id);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(id)) {
      this.artifactIdList.push(id);
    }

    // Track artifacts by messageId for message-level operations
    if (!this.#messageToArtifactIds.has(messageId)) {
      this.#messageToArtifactIds.set(messageId, []);
    }

    this.#messageToArtifactIds.get(messageId)!.push(id);

    this.artifacts.setKey(id, {
      id,
      title,
      closed: false,
      type,
      runner: new ActionRunner(
        this.container,
        () => this.boltTerminal,
        (alert) => {
          if (isCommitedMessage(messageId)) {
            return;
          }

          if (!shouldIgnoreError(alert)) {
            this.actionAlert.set(alert);
          }
        },
      ),
    });
  }

  /**
   * Check if message has any associated artifacts
   */
  hasMessageArtifacts(messageId: string): boolean {
    const compositeIds = this.#messageToArtifactIds.get(messageId) || [];
    return compositeIds.length > 0;
  }

  /**
   * Check if message is idle (all artifacts closed and action queue empty)
   */
  isMessageIdle(messageId: string): boolean {
    const compositeIds = this.#messageToArtifactIds.get(messageId) || [];
    const allClosed = compositeIds.every((compositeId) => {
      const artifact = this.#getArtifact(compositeId);

      return artifact?.closed;
    });
    const queueEmpty = !this.#messageToActionQueue.has(messageId);

    return allClosed && queueEmpty;
  }

  /**
   * Wait for message to become idle (all artifacts closed and action queue empty)
   * Returns immediately if already idle
   */
  waitForMessageIdle(messageId: string, options: { timeoutMs?: number } = {}): Promise<void> {
    // Already idle - return immediately
    if (this.isMessageIdle(messageId)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 35000;
      let timeoutId: NodeJS.Timeout | null = null;
      let pollingIntervalId: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (pollingIntervalId) {
          clearInterval(pollingIntervalId);
          pollingIntervalId = null;
        }
      };

      const callback = () => {
        cleanup();
        resolve();
      };

      const removeCallback = () => {
        const callbacks = this.#messageIdleCallbacks.get(messageId);

        if (callbacks) {
          const index = callbacks.findIndex((fn) => fn === callback);

          if (index !== -1) {
            callbacks.splice(index, 1);
          }

          if (callbacks.length === 0) {
            this.#messageIdleCallbacks.delete(messageId);
          }
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        removeCallback();
        reject(new Error(`Message ${messageId} idle timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      pollingIntervalId = setInterval(() => {
        if (this.isMessageIdle(messageId)) {
          cleanup();
          removeCallback();
          resolve();
        }
      }, 500);

      if (!this.#messageIdleCallbacks.has(messageId)) {
        this.#messageIdleCallbacks.set(messageId, []);
      }

      this.#messageIdleCallbacks.get(messageId)!.push(callback);
    });
  }

  hasRunningArtifactActions(): boolean {
    const artifacts = this.artifacts.get();
    return Object.values(artifacts).some((artifact) => artifact.runner.isRunning());
  }

  async #processMessageClose(messageId: string) {
    // Check if message is idle first
    if (!this.isMessageIdle(messageId)) {
      return; // Not idle yet, do nothing
    }

    // Trigger registered callbacks for this messageId if all artifacts are closed
    const closeCallbacks = this.#messageCloseCallbacks.get(messageId);

    if (closeCallbacks && closeCallbacks.length > 0) {
      // Copy callbacks and clear map before execution to prevent duplicate runs
      const closeCallbackCopy = [...closeCallbacks];
      this.#messageCloseCallbacks.delete(messageId);

      logger.debug(`Executing ${closeCallbackCopy.length} close callbacks for message ${messageId}`);
      await Promise.all(closeCallbackCopy.map((callback) => callback()));
    }

    // Resolve idle waiters for this messageId
    const idleCallbacks = this.#messageIdleCallbacks.get(messageId);

    if (idleCallbacks && idleCallbacks.length > 0) {
      const idleCallbackCopy = [...idleCallbacks];
      this.#messageIdleCallbacks.delete(messageId);

      logger.debug(`Resolving ${idleCallbackCopy.length} idle callbacks for message ${messageId}`);

      idleCallbackCopy.forEach((fn) => fn());
    }
  }

  onMessageClose(messageId: string, callback: () => Promise<void>) {
    if (!this.#messageCloseCallbacks.has(messageId)) {
      this.#messageCloseCallbacks.set(messageId, []);
    }

    this.#messageCloseCallbacks.get(messageId)?.push(callback);

    this.#processMessageClose(messageId);
  }

  async closeArtifact(data: ArtifactCallbackData) {
    const artifact = this.#getArtifact(data.id);

    if (isCommitedMessage(data.messageId)) {
      artifact.runner.resetPendingActionsCount();
    }

    if (artifact?.closed) {
      return;
    }

    if (artifact?.runner.isRunning()) {
      artifact.runner.onComplete = () => {
        this.closeArtifact(data);
      };
      return;
    }

    this.updateArtifact(data, { closed: true });

    const { messageId } = data;

    this.#processMessageClose(messageId);
  }

  updateArtifact({ id }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(id);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(id, { ...artifact, ...state });
  }

  addAction(data: ActionCallbackData) {
    this._addAction(data);
  }

  _addAction(data: ActionCallbackData) {
    const { artifactId } = data;

    const artifact = this.#getArtifact(artifactId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    return artifact.runner.addAction(data);
  }

  runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    if (isStreaming) {
      this.actionStreamSampler(data, isStreaming);
    } else {
      this._runAction(data, isStreaming);
    }
  }

  async #executeQueuedAction(data: ActionCallbackData, artifact: ArtifactState, isStreaming: boolean = false) {
    const { messageId } = data;

    const action = artifact.runner.actions.get()[data.actionId];

    if (!action || action.executed) {
      return;
    }

    // Don't run the action if it's a reload
    if (isCommitedMessage(messageId)) {
      artifact.runner.actions.setKey(data.actionId, { ...action, executed: true, status: 'complete' });

      return;
    }

    if (data.action.type === 'file') {
      const wc = await this.container;
      const fullPath = path.join(wc.workdir, data.action.filePath);

      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }

      if (this.currentView.value !== 'code') {
        this.currentView.set('code');
      }

      const doc = this.#editorStore.documents.get()[fullPath];

      if (!doc) {
        await artifact.runner.runAction(data, isStreaming);
      }

      this.#editorStore.updateFile(fullPath, data.action.content);

      if (!isStreaming) {
        await artifact.runner.runAction(data);
        this.resetAllFileModifications();
      }
    } else if (data.action.type === 'modify') {
      // Handle modify action similar to file action but let ActionRunner apply the modifications
      const wc = await this.container;
      const fullPath = path.join(wc.workdir, data.action.filePath);

      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }

      if (this.currentView.value !== 'code') {
        this.currentView.set('code');
      }

      await artifact.runner.runAction(data);

      // Refresh the editor to show updated content
      const relativePath = data.action.filePath.replace(/^\/home\/project\//, '');

      const updatedContent = (await wc.fs.readFile(relativePath, 'utf-8')) as string;
      this.#editorStore.updateFile(fullPath, updatedContent);

      this.resetAllFileModifications();
    } else if (data.action.type === 'shell') {
      // Shell commands are now queued, so just execute them directly here
      await artifact.runner.runAction(data);
    } else {
      await artifact.runner.runAction(data);
    }
  }

  async _runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { artifactId, messageId } = data;

    const artifact = this.#getArtifact(artifactId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    const action = artifact.runner.actions.get()[data.actionId];

    if (!action || action.executed) {
      return;
    }

    // Don't run the action if it's a reload
    if (isCommitedMessage(messageId)) {
      artifact.runner.actions.setKey(data.actionId, { ...action, executed: true, status: 'complete' });

      return;
    }

    // Queue all actions for sequential execution per message
    this.#queueAction(data, artifact, isStreaming);
  }

  actionStreamSampler = createSampler(async (data: ActionCallbackData, isStreaming: boolean = false) => {
    return await this._runAction(data, isStreaming);
  }, 100); // TODO: remove this magic number to have it configurable

  #getArtifact(compositeId: string) {
    const artifacts = this.artifacts.get();
    return artifacts[compositeId];
  }

  #queueAction(data: ActionCallbackData, artifact: ArtifactState, isStreaming: boolean = false) {
    artifact.runner.markActionAsRunning(data.actionId);

    const newItem: ActionQueueItem = {
      data,
      executeAction: () => {
        this.#executeQueuedAction(newItem.data, artifact, isStreaming).finally(() => {
          if (newItem.next) {
            const nextArtifact = this.#getArtifact(newItem.next.data.artifactId);

            if (nextArtifact) {
              this.#executeActionItem(newItem.next);
            }
          } else {
            // No more items, clear the queue
            this.#messageToActionQueue.delete(data.messageId);

            // Check if all artifacts are closed now that queue is empty
            this.#processMessageClose(data.messageId);
          }
        });
      },
    };

    const currentQueue = this.#messageToActionQueue.get(data.messageId);

    if (!currentQueue) {
      this.#executeActionItem(newItem);
    } else {
      let tail = currentQueue;

      while (tail.next) {
        tail = tail.next;
      }
      tail.next = newItem;
    }
  }

  #executeActionItem(item: ActionQueueItem) {
    this.#messageToActionQueue.set(item.data.messageId, item);

    item.executeAction();
  }

  async generateZip() {
    const zip = new JSZip();
    const files = this.files.get();

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);

        // split the path into segments
        const pathSegments = relativePath.split('/');

        // if there's more than one segment, we need to create folders
        if (pathSegments.length > 1) {
          let currentFolder = zip;

          for (let i = 0; i < pathSegments.length - 1; i++) {
            currentFolder = currentFolder.folder(pathSegments[i])!;
          }
          currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
        } else {
          // if there's only one segment, it's a file in the root
          zip.file(relativePath, dirent.content);
        }
      }
    }

    // Generate the zip file and save it
    const content = await zip.generateAsync({ type: 'blob' });

    return content;
  }

  async downloadZip() {
    // Get the project name from the description input, or use a default name
    const projectName = (repoStore.get().name ?? 'project').toLocaleLowerCase().split(' ').join('_');

    // Generate a simple 6-character hash based on the current timestamp
    const timestampHash = Date.now().toString(36).slice(-6);
    const uniqueProjectName = `${projectName}_${timestampHash}`;

    const content = await this.generateZip();
    saveAs(content, `${uniqueProjectName}.zip`);
  }

  async syncFiles(targetHandle: FileSystemDirectoryHandle) {
    const files = this.files.get();
    const syncedFiles = [];

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);
        const pathSegments = relativePath.split('/');
        let currentHandle = targetHandle;

        for (let i = 0; i < pathSegments.length - 1; i++) {
          currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
        }

        // create or get the file
        const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], {
          create: true,
        });

        // write the file content
        const writable = await fileHandle.createWritable();
        await writable.write(dirent.content);
        await writable.close();

        syncedFiles.push(relativePath);
      }
    }

    return syncedFiles;
  }

  // 퍼블리시된 URL 설정 메서드 추가
  setPublishedUrl(url: string) {
    this.#previewsStore.setPublishedUrl(url);
  }

  async commitModifiedFiles(signal?: AbortSignal): Promise<{ id: string; message: string } | undefined> {
    const modifiedFiles = this.getModifiedFiles();

    let result;

    if (modifiedFiles !== undefined) {
      if (isEnabledGitbasePersistence) {
        const { data: commit } = await commitUserChanged(signal);
        const id = 'assistant-' + commit.commitHash;

        result = { id, message: commit.message };
      }

      this.resetAllFileModifications();
    }

    return result;
  }

  async injectTokenEnvironment(shell: BoltShell, accessToken: string, signal?: AbortSignal) {
    const checkAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('Inject token environment aborted by user', ERROR_NAMES.ABORT);
      }
    };

    checkAborted();

    const wc = await this.container;

    checkAborted();

    try {
      const setupScript = '#!/bin/sh\n\nexport V8_ACCESS_TOKEN="' + accessToken + '"';
      await wc.fs.writeFile('.secret', setupScript);
      checkAborted();

      await this.#runShellCommand(shell, 'source ./.secret && rm -f ./.secret', signal);
    } catch (error) {
      if (isAbortError(error)) {
        logger.debug('inject token environment aborted by user');
        return;
      }

      throw new Error('Failed to inject user data into the shell.');
    } finally {
      await wc.fs.rm('.secret').catch(() => {
        // File might not exist or removal failed, ignore the error
      });
    }
  }

  async setupEnvFile(user: V8User, reset: boolean = false, signal?: AbortSignal) {
    const checkAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('Setup env file aborted by user', ERROR_NAMES.ABORT);
      }
    };

    checkAborted();

    const wc = await this.container;

    checkAborted();

    const files = this.files.get();

    if (!files || Object.keys(files).length === 0) {
      throw new Error('Files not found');
    }

    let envFile = (files[`${WORK_DIR}/.env`] as File)?.content || '';

    try {
      if (!envFile) {
        envFile = await wc.fs.readFile('.env', 'utf-8');
      }
    } catch {
      // File might not exist yet, continue with empty content
    }

    checkAborted();

    // Parse existing environment variables
    const envVars = this.#parseEnvFile(envFile);
    const currentAccount = envVars.VITE_AGENT8_ACCOUNT;
    const currentVerse = envVars.VITE_AGENT8_VERSE;
    const userIdentifiers = [user.walletAddress, user.userUid].filter(Boolean);

    if (
      userIdentifiers.some((id) => currentAccount === id) &&
      userIdentifiers.some((id) => currentVerse?.startsWith(id)) &&
      !reset
    ) {
      return currentVerse;
    }

    envVars.VITE_AGENT8_ACCOUNT = user.walletAddress || user.userUid;

    const verseId = generateVerseId(envVars.VITE_AGENT8_ACCOUNT);
    envVars.VITE_AGENT8_VERSE = verseId;

    const updatedEnvContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await this.#filesStore.saveFile('.env', updatedEnvContent);
    checkAborted();

    return verseId;
  }

  // Helper method to parse .env file
  #parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {};

    if (!content) {
      return result;
    }

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf('=');

      if (separatorIndex > 0) {
        const key = trimmedLine.substring(0, separatorIndex);
        const value = trimmedLine.substring(separatorIndex + 1);
        result[key] = value;
      }
    }

    return result;
  }

  async setupDeployConfig(shell: BoltShell, signal?: AbortSignal, options: { reset: boolean } = { reset: false }) {
    const checkAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('Setup deploy config aborted by user', ERROR_NAMES.ABORT);
      }
    };

    checkAborted();

    // Get access token
    const accessToken = localStorage.getItem(V8_ACCESS_TOKEN_KEY);

    if (!accessToken) {
      throw new Error('No access token found');
    }

    checkAborted();

    // Verify user
    const user = await verifyV8AccessToken(import.meta.env.VITE_V8_AUTH_API_ENDPOINT, accessToken, signal);

    checkAborted();

    if (!user.isActivated) {
      throw new Error('Account is not activated');
    }

    // Setup environment
    await this.injectTokenEnvironment(shell, accessToken, signal);

    checkAborted();

    const verseId = await this.setupEnvFile(user, options.reset, signal);

    checkAborted();

    return { user, verseId };
  }

  async runPreview() {
    if (this.isRunningPreview.get()) {
      return;
    }

    try {
      this.isRunningPreview.set(true);

      this.abortAllActions();

      this.#runPreviewAbortController = new AbortController();

      const signal = this.#runPreviewAbortController.signal;

      const checkAborted = () => {
        if (signal?.aborted) {
          throw new DOMException('Run preview aborted by user', ERROR_NAMES.ABORT);
        }
      };

      checkAborted();

      this.currentView.set('code');

      const shell = this.boltTerminal;
      await shell.ready;

      checkAborted();

      await this.setupDeployConfig(shell, signal);

      checkAborted();

      // Navigate to working directory
      const container = await this.container;

      checkAborted();

      await this.#runShellCommand(shell, `cd ${container.workdir}`, signal);

      checkAborted();

      // Run development server
      if (localStorage.getItem(SETTINGS_KEYS.AGENT8_DEPLOY) === 'false') {
        await this.#runShellCommand(
          shell,
          `${SHELL_COMMANDS.UPDATE_DEPENDENCIES} && ${SHELL_COMMANDS.START_DEV_SERVER}`,
          signal,
        );
        checkAborted();
      } else {
        await this.#runShellCommand(
          shell,
          `${SHELL_COMMANDS.UPDATE_DEPENDENCIES} && npx -y @agent8/deploy --preview && ${SHELL_COMMANDS.START_DEV_SERVER}`,
          signal,
        );
        checkAborted();
      }
    } catch (error) {
      if (isAbortError(error)) {
        logger.info('runPreview aborted by user');
        return;
      }

      logger.error('[RunPreview] Error:', error);
      throw error;
    } finally {
      this.#runPreviewAbortController = null;
      this.isRunningPreview.set(false);
    }
  }

  async publish(chatId: string, title: string) {
    if (this.isDeploying.get()) {
      return;
    }

    let failedReason = '';

    try {
      this.isDeploying.set(true);

      this.abortAllActions();

      this.#publishAbortController = new AbortController();

      const signal = this.#publishAbortController.signal;

      const checkAborted = () => {
        if (signal?.aborted) {
          throw new DOMException('Publish aborted by user', ERROR_NAMES.ABORT);
        }
      };

      checkAborted();

      this.currentView.set('code');

      checkAborted();

      const shell = this.boltTerminal;
      await shell.ready;

      checkAborted();

      // Install dependencies
      await this.#runShellCommand(shell, 'rm -rf dist', signal);
      checkAborted();

      await this.#runShellCommand(shell, SHELL_COMMANDS.UPDATE_DEPENDENCIES, signal);
      checkAborted();

      if (localStorage.getItem(SETTINGS_KEYS.AGENT8_DEPLOY) === 'false') {
        toast.error('Agent8 deploy is disabled. Please enable it in the settings.');
        return;
      }

      const { verseId } = await this.setupDeployConfig(shell, signal);
      checkAborted();

      await this.commitModifiedFiles(signal);
      checkAborted();

      const container = await this.container;
      checkAborted();

      await this.#runShellCommand(shell, `cd ${container.workdir}`, signal);
      checkAborted();

      // Build project
      const buildResult = await this.#runShellCommand(shell, `${SHELL_COMMANDS.BUILD_PROJECT} --base ./`, signal);
      checkAborted();

      if (buildResult?.exitCode === 2) {
        this.#handleBuildError(buildResult.output);
        return;
      }

      const wc = await this.container;
      checkAborted();

      let buildFile = '';

      try {
        buildFile = await wc.fs.readFile('dist/index.html', 'utf-8');
      } catch (error) {
        failedReason = 'read build file';
        console.error('Failed to read build file', error);
      }
      checkAborted();

      if (!buildFile) {
        failedReason = 'no build file';
        throw new Error();
      }

      // Deploy project
      const deployResult = await this.#runShellCommand(shell, 'npx -y @agent8/deploy --prod', signal);
      checkAborted();

      if (deployResult?.exitCode !== 0) {
        throw new Error();
      }

      const taskBranch = repoStore.get().taskBranch;
      let lastCommitHash = '';

      try {
        lastCommitHash = await getLastCommitHash(repoStore.get().path, taskBranch || 'develop');
      } catch (error) {
        failedReason = 'task not found';
        throw error;
      }
      checkAborted();

      const { tags } = await getTags(repoStore.get().path);

      checkAborted();

      const spinTag = tags.find((tag: any) => tag.name.startsWith('verse-from'));
      let parentVerseId;

      if (spinTag) {
        parentVerseId = spinTag.name.replace('verse-from-', '').trim();
      }

      // Handle successful deployment
      this.#handleSuccessfulDeployment(verseId, chatId, title, lastCommitHash, parentVerseId);
    } catch (error) {
      if (isAbortError(error)) {
        logger.debug('publish aborted by user');
        return;
      }

      const errorMessage = 'Failed to publish';
      logger.error('[Publish] Error:', error);
      throw new DeployError(failedReason ? `${errorMessage}: ${failedReason}` : errorMessage);
    } finally {
      this.isDeploying.set(false);
      this.#publishAbortController = null;
    }
  }

  // Helper methods for publish
  async #runShellCommand(shell: BoltShell, command: string, signal?: AbortSignal) {
    const checkAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('Run shell command aborted by user', ERROR_NAMES.ABORT);
      }
    };

    this.#shellCommandQueue = this.#shellCommandQueue.then(async () => {
      checkAborted();

      const result = await shell.executeCommand(Date.now().toString(), command, undefined, { signal });

      checkAborted();

      await shell.waitTillOscCode('prompt', signal);

      checkAborted();

      return result;
    });

    return this.#shellCommandQueue;
  }

  #handleBuildError(output: string) {
    logger.error('[Publish] Build Failed:', output);

    const alert = {
      type: 'build',
      title: 'Build Error',
      description: 'Failed to build the project',
      content: output || 'Unknown build error',
      source: 'terminal',
    } satisfies ActionAlert;

    if (!shouldIgnoreError(alert)) {
      this.actionAlert.set(alert);
    }
  }

  #handleSuccessfulDeployment(verseId: string, chatId: string, title: string, sha?: string, parentVerseId?: string) {
    const publishedUrl = `${import.meta.env.VITE_PUBLISHED_BASE_URL || 'https://agent8-games.verse8.io'}/${verseId}/index.html?chatId=${encodeURIComponent(chatId)}${sha ? `&sha=${sha}` : ''}&buildAt=${Date.now()}`;

    // this.setPublishedUrl(publishedUrl);

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'PUBLISH_GAME',
            payload: {
              title,
              gameId: verseId,
              playUrl: publishedUrl,
              parentVerseId,
            },
          },
          '*',
        );
        logger.info('[Publish] Sent deployment info to parent window');
      }
    } catch (error) {
      logger.error('[Publish] Error sending message to parent:', error);

      // Communication failure doesn't affect deployment success
    }
  }
}

export const workbenchStore = new WorkbenchStore();
export const reinitCounterAtom = workbenchStore.reinitCounter;
export const containerAtom = workbenchStore.containerAtom;
export const connectionStateAtom = workbenchStore.connectionState;
