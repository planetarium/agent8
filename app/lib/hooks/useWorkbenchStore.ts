import { useStore } from '@nanostores/react';
import { workbenchStore, reinitCounterAtom } from '~/lib/stores/workbench';
import { V8_ACCESS_TOKEN_KEY } from '~/lib/verse8/userAuth';

export function useWorkbenchFiles() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.files);
}

export function useWorkbenchSelectedFile() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.selectedFile);
}

export function useWorkbenchCurrentDocument() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.currentDocument);
}

export function useWorkbenchPreviews() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.previews);
}

export function useWorkbenchShowTerminal() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.showTerminal);
}

export function useWorkbenchShowWorkbench() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.showWorkbench);
}

export function useWorkbenchCurrentView() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.currentView);
}

export function useWorkbenchUnsavedFiles() {
  useStore(reinitCounterAtom);

  const unsavedFiles = useStore(workbenchStore.unsavedFiles);

  if (!(unsavedFiles instanceof Set)) {
    console.warn('unsavedFiles is not a Set in useWorkbenchUnsavedFiles, returning empty Set');

    return new Set<string>();
  }

  return unsavedFiles;
}

export function useWorkbenchActionAlert() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.actionAlert);
}

export function useWorkbenchMessageRunners() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.messageRunners);
}

export function useWorkbenchDiffCommitHash() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.diffCommitHash);
}

export function useWorkbenchDiffEnabled() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.diffEnabled);
}

export function useWorkbenchConnectionState() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.connectionState);
}

export function useWorkbenchContainer() {
  useStore(reinitCounterAtom);
  return useStore(workbenchStore.containerAtom);
}

export function useWorkbenchStore() {
  useStore(reinitCounterAtom);
  return workbenchStore;
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__workbenchDebug = {
    reinitialize: async (accessToken?: string) => {
      try {
        const token = accessToken || localStorage.getItem(V8_ACCESS_TOKEN_KEY) || '';

        console.log('🔄 Reinitializing workbench container...');

        const result = await workbenchStore.reinitializeContainer(token);

        if (result) {
          console.log('✅ Workbench container reinitialized successfully.');
        } else {
          console.log('❌ Failed to reinitialize workbench container.');
        }

        return result;
      } catch (error) {
        console.error('❌ Error during reinitialization:', error);
        throw error;
      }
    },

    // Check container status
    getContainerStatus: () => {
      return {
        ready: workbenchStore.containerReady,
        reinitCounter: reinitCounterAtom.get(),
        filesCount: workbenchStore.filesCount,
        showWorkbench: workbenchStore.showWorkbench.get(),
      };
    },

    // Check file status
    getFilesInfo: () => {
      const files = workbenchStore.files.get();

      return {
        totalFiles: Object.keys(files).length,
        modifiedFiles: Array.from(workbenchStore.modifiedFiles),
        unsavedFiles: Array.from(workbenchStore.unsavedFiles.get()),
        selectedFile: workbenchStore.selectedFile.get(),
      };
    },

    // Check message runners status
    getMessageRunnersInfo: () => {
      const messageRunners = workbenchStore.messageRunners.get();

      return {
        totalRunners: Object.keys(messageRunners).length,
        messageIds: workbenchStore.messageIdList,
        runners: Object.keys(messageRunners).map((id) => ({
          messageId: id,
          isRunning: messageRunners[id].runner.isRunning(),
        })),
      };
    },

    // Display all information at once
    status: () => {
      console.group('🛠️ Workbench Status');
      console.log('Container:', (window as any).__workbenchDebug.getContainerStatus());
      console.log('Files:', (window as any).__workbenchDebug.getFilesInfo());
      console.log('Message Runners:', (window as any).__workbenchDebug.getMessageRunnersInfo());
      console.groupEnd();
    },

    // Help
    help: () => {
      console.log(`
🛠️ Workbench Debug Tool Usage:

__workbenchDebug.reinitialize()     - Reinitialize workbench container
__workbenchDebug.status()           - Check overall status
__workbenchDebug.getContainerStatus() - Check container status
__workbenchDebug.getFilesInfo()     - Check file status
__workbenchDebug.getMessageRunnersInfo() - Check message runners status
__workbenchDebug.help()             - Display this help

Examples:
await __workbenchDebug.reinitialize('your_token_here')
__workbenchDebug.status()
      `);
    },
  };

  console.log('🛠️ Workbench debug tool loaded. Run __workbenchDebug.help() to see usage instructions.');
}
