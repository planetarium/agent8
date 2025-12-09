import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { fetchProjectFiles, setRestorePoint } from '~/lib/persistenceGitbase/api.client';
import { triggerRestoreEvent } from '~/lib/stores/restore';
import { convertFileMapToFileSystemTree } from '~/utils/fileUtils';
import { handleChatError } from '~/utils/errorNotification';
import { V8_ACCESS_TOKEN_KEY } from '~/lib/verse8/userAuth';

export interface RestoreVersionParams {
  projectPath: string;
  commitHash: string;
  commitTitle: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Common restore version logic used by both Version History and Chat
 * This ensures identical behavior across all restore entry points
 */
export async function restoreVersion({
  projectPath,
  commitHash,
  commitTitle,
  onSuccess,
  onError,
}: RestoreVersionParams): Promise<boolean> {
  const toastId = toast.loading('Restoring version...');

  try {
    // Fetch files from the specific commit
    const files = await fetchProjectFiles(projectPath, commitHash);

    if (!files || Object.keys(files).length === 0) {
      throw new Error('No files found in commit');
    }

    // Reinitialize container to restart terminal
    const accessToken = localStorage.getItem(V8_ACCESS_TOKEN_KEY) || '';
    await workbenchStore.reinitializeContainer(accessToken);

    // Get container instance after reinitialization
    const containerInstance = await workbenchStore.container;

    // Remove existing directories to ensure clean state
    try {
      await containerInstance.fs.rm('/src', { recursive: true, force: true });
      await containerInstance.fs.rm('/PROJECT', { recursive: true, force: true });
    } catch {
      // Ignore error if directories don't exist
    }

    // Mount the files from the commit
    await containerInstance.mount(convertFileMapToFileSystemTree(files));
    workbenchStore.resetAllFileModifications();

    // Run preview to start dev server with restored files
    await workbenchStore.runPreview();

    // Save restore point to GitLab
    try {
      await setRestorePoint(projectPath, commitHash, commitTitle);
    } catch (err) {
      console.warn('Failed to save restore point to GitLab:', err);

      // Continue even if saving fails
    }

    // Update URL with revertTo parameter to ensure commits are based on this version
    window.history.replaceState(null, '', `/chat/${projectPath}?revertTo=${commitHash}`);

    // Trigger restore event to add message to chat
    triggerRestoreEvent(commitHash, commitTitle);

    toast.dismiss(toastId);
    toast.success('Version restored successfully');

    onSuccess?.();

    return true;
  } catch (error) {
    toast.dismiss(toastId);
    handleChatError('Failed to restore version', {
      error: error instanceof Error ? error : String(error),
      context: 'restoreVersion - restore process',
    });

    onError?.(error instanceof Error ? error : new Error(String(error)));

    return false;
  }
}
