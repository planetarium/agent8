import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { container } from '~/lib/container';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import JSZip from 'jszip';
import fileSaver from 'file-saver';
import { path } from '~/utils/path';
import { extractRelativePath } from '~/utils/diff';
import { createSampler } from '~/utils/sampler';
import type { ActionAlert } from '~/types/actions';
import { repoStore } from './repo';
import { isEnabledGitbasePersistence, commitUserChanged } from '~/lib/persistenceGitbase/api.client';
import { V8_ACCESS_TOKEN_KEY, verifyV8AccessToken, type V8User } from '~/lib/verse8/userAuth';
import type { BoltShell } from '~/utils/shell';
import { logger } from '~/utils/logger';
import { SETTINGS_KEYS } from './settings';
import { toast } from 'react-toastify';

const { saveAs } = fileSaver;

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
  #previewsStore = new PreviewsStore(container);
  #filesStore = new FilesStore(container);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(container);

  #reloadedMessages = new Set<string>();

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  actionAlert: WritableAtom<ActionAlert | undefined> =
    import.meta.hot?.data.unsavedFiles ?? atom<ActionAlert | undefined>(undefined);
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #globalExecutionQueue = Promise.resolve();
  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.actionAlert = this.actionAlert;
    }
  }

  addToExecutionQueue(callback: () => Promise<void>) {
    this.#globalExecutionQueue = this.#globalExecutionQueue.then(() => callback());
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

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();

    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();

      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) {
        return;
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles);

      if (unsavedChanges) {
        newUnsavedFiles.add(currentDocument.filePath);
      } else {
        newUnsavedFiles.delete(currentDocument.filePath);
      }

      this.unsavedFiles.set(newUnsavedFiles);
    }
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

    await this.#filesStore.saveFile(filePath, document.value);

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

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  setReloadedMessages(messages: string[]) {
    this.#reloadedMessages = new Set(messages);
  }

  addArtifact({ messageId, title, id, type }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      type,
      runner: new ActionRunner(
        container,
        () => this.boltTerminal,
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) {
            return;
          }

          this.actionAlert.set(alert);
        },
      ),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }
  addAction(data: ActionCallbackData) {
    // this._addAction(data);

    this.addToExecutionQueue(() => this._addAction(data));
  }
  async _addAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    return artifact.runner.addAction(data);
  }

  runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    if (isStreaming) {
      this.actionStreamSampler(data, isStreaming);
    } else {
      this.addToExecutionQueue(() => this._runAction(data, isStreaming));
    }
  }
  async _runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    const action = artifact.runner.actions.get()[data.actionId];

    if (!action || action.executed) {
      return;
    }

    // Don't run the action if it's a reload
    if (this.#reloadedMessages.has(messageId)) {
      artifact.runner.actions.setKey(data.actionId, { ...action, executed: true, status: 'complete' });
      return;
    }

    if (data.action.type === 'file') {
      const wc = await container;
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
    } else {
      await artifact.runner.runAction(data);
    }
  }

  actionStreamSampler = createSampler(async (data: ActionCallbackData, isStreaming: boolean = false) => {
    return await this._runAction(data, isStreaming);
  }, 100); // TODO: remove this magic number to have it configurable

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
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

  async commitModifiedFiles(): Promise<{ id: string; message: string } | undefined> {
    const modifiedFiles = this.getModifiedFiles();

    let result;

    if (modifiedFiles !== undefined) {
      if (isEnabledGitbasePersistence) {
        const { data: commit } = await commitUserChanged();
        const id = 'assistant-' + commit.commitHash;
        this.setReloadedMessages([...this.#reloadedMessages, id]);

        result = { id, message: commit.message };
      }

      this.resetAllFileModifications();
    }

    return result;
  }

  async injectTokenEnvironment(shell: BoltShell, accessToken: string) {
    const wc = await container;

    try {
      const setupScript = '#!/bin/sh\n\nexport V8_ACCESS_TOKEN="' + accessToken + '"';
      await wc.fs.writeFile('.secret', setupScript);
      await shell.executeCommand(Date.now().toString(), 'source ./.secret && rm -f ./.secret');
      await shell.waitTillOscCode('prompt');
    } catch {
      throw new Error('Failed to inject user data into the shell.');
    } finally {
      try {
        await wc.fs.rm('.secret');
      } catch {
        // File might not exist yet, continue with empty content
      }
    }
  }

  async setupEnvFile(user: V8User, reset: boolean = false) {
    const wc = await container;
    let envFile = '';

    try {
      envFile = await wc.fs.readFile('.env', 'utf-8');
    } catch {
      // File might not exist yet, continue with empty content
    }

    // Parse existing environment variables
    const envVars = this.#parseEnvFile(envFile);
    const currentAccount = envVars.VITE_AGENT8_ACCOUNT;
    const currentVerse = envVars.VITE_AGENT8_VERSE;

    if (
      (currentAccount === user.walletAddress || currentAccount === user.userUid) &&
      currentVerse?.startsWith(currentAccount) &&
      !reset
    ) {
      return currentVerse;
    }

    envVars.VITE_AGENT8_ACCOUNT = user.walletAddress || user.userUid;

    const verseId = envVars.VITE_AGENT8_ACCOUNT + '-' + new Date().getTime();
    envVars.VITE_AGENT8_VERSE = verseId;

    const updatedEnvContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await this.#filesStore.saveFile('.env', updatedEnvContent);

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

  async setupDeployConfig(shell: BoltShell, options: { reset: boolean } = { reset: false }) {
    // Get access token
    const accessToken = localStorage.getItem(V8_ACCESS_TOKEN_KEY);

    if (!accessToken) {
      throw new Error('No access token found');
    }

    // Verify user
    const user = await verifyV8AccessToken(import.meta.env.VITE_V8_API_ENDPOINT, accessToken);

    if (!user.isActivated) {
      throw new Error('Account is not activated');
    }

    // Setup environment
    await this.injectTokenEnvironment(shell, accessToken);

    const verseId = await this.setupEnvFile(user, options.reset);

    return { user, verseId };
  }

  async publish(chatId: string, title: string) {
    this.currentView.set('code');

    const shell = this.boltTerminal;
    await shell.ready;

    try {
      // Install dependencies
      await this.#runShellCommand(shell, 'pnpm install');

      if (localStorage.getItem(SETTINGS_KEYS.AGENT8_DEPLOY) === 'false') {
        toast.error('Agent8 deploy is disabled. Please enable it in the settings.');
        return;
      }

      const { verseId } = await this.setupDeployConfig(shell);
      await this.commitModifiedFiles();

      // Build project
      const buildResult = await this.#runShellCommand(shell, 'pnpm run build');

      if (buildResult?.exitCode === 2) {
        this.#handleBuildError(buildResult.output);
        return;
      }

      // Deploy project
      const deployResult = await this.#runShellCommand(shell, 'npx -y @agent8/deploy --prod');

      if (deployResult?.exitCode !== 0) {
        throw new Error('Failed to publish');
      }

      // Handle successful deployment
      this.#handleSuccessfulDeployment(verseId, chatId, title);
    } catch (error) {
      logger.error('[Publish] Error:', error);
      throw error;
    }
  }

  // Helper methods for publish
  async #runShellCommand(shell: BoltShell, command: string) {
    const result = await shell.executeCommand(Date.now().toString(), command);
    await shell.waitTillOscCode('prompt');

    return result;
  }

  #handleBuildError(output: string) {
    logger.error('[Publish] Build Failed:', output);
    this.actionAlert.set({
      type: 'build',
      title: 'Build Error',
      description: 'Failed to build the project',
      content: output || 'Unknown build error',
      source: 'terminal',
    });
  }

  #handleSuccessfulDeployment(verseId: string, chatId: string, title: string) {
    const publishedUrl = `${import.meta.env.VITE_PUBLISHED_BASE_URL || 'https://agent8-games.verse8.io'}/${verseId}/index.html?chatId=${encodeURIComponent(chatId)}&buildAt=${Date.now()}`;
    this.setPublishedUrl(publishedUrl);

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'PUBLISH_GAME',
            payload: {
              title,
              gameId: verseId,
              playUrl: publishedUrl,
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
