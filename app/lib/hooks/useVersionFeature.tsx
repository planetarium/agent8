import React from 'react';
import { toast } from 'react-toastify';
import type { UIMessage } from 'ai';
import { useStore } from '@nanostores/react';

import { repoStore } from '~/lib/stores/repo';
import { versionEventStore } from '~/lib/stores/versionEvent';
import { isEnabledGitbasePersistence, getCommit } from '~/lib/persistenceGitbase/api.client';
import { isCommitHash } from '~/lib/persistenceGitbase/utils';

import { handleChatError } from '~/utils/errorNotification';
import { stripMetadata } from '~/components/chat/UserMessage';
import { restoreVersion } from '~/utils/restoreVersion';

import { RestoreConfirmModal } from '~/components/ui/Restore';
import { SaveVersionConfirmModal } from '~/components/ui/SaveVersion';

interface RestoreInfo {
  commitHash: string;
  commitTitle: string;
}

interface State {
  save: { open: boolean; message: UIMessage | null };
  restore: { open: boolean; info: RestoreInfo | null };
  savedVersions: Map<string, string>;
}

type Action =
  | { type: 'OPEN_SAVE'; message: UIMessage }
  | { type: 'CLOSE_SAVE' }
  | { type: 'OPEN_RESTORE'; info: RestoreInfo }
  | { type: 'CLOSE_RESTORE' }
  | { type: 'SET_SAVED_VERSIONS'; versions: Map<string, string> }
  | { type: 'ADD_SAVED_VERSION'; commitHash: string; commitTitle: string }
  | { type: 'REMOVE_SAVED_VERSION'; commitHash: string };

const initialState: State = {
  save: { open: false, message: null },
  restore: { open: false, info: null },
  savedVersions: new Map(),
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPEN_SAVE':
      return { ...state, save: { open: true, message: action.message } };
    case 'CLOSE_SAVE':
      return { ...state, save: { open: false, message: null } };
    case 'OPEN_RESTORE':
      return { ...state, restore: { open: true, info: action.info } };
    case 'CLOSE_RESTORE':
      return { ...state, restore: { open: false, info: null } };

    case 'SET_SAVED_VERSIONS':
      return { ...state, savedVersions: action.versions };

    case 'ADD_SAVED_VERSION': {
      const next = new Map(state.savedVersions);
      next.set(action.commitHash, action.commitTitle);

      return { ...state, savedVersions: next };
    }

    case 'REMOVE_SAVED_VERSION': {
      const next = new Map(state.savedVersions);
      next.delete(action.commitHash);

      return { ...state, savedVersions: next };
    }

    default:
      return state;
  }
}

interface VersionEntry {
  commitHash: string;
  commitTitle: string;
}

export function useVersionFeature() {
  const repo = useStore(repoStore);
  const projectPath = repo.path;

  const [state, dispatch] = React.useReducer(reducer, initialState);

  // 1) load savedVersions (only if Gitbase persistence is enabled)
  React.useEffect(() => {
    let cancelled = false;

    if (projectPath && isEnabledGitbasePersistence) {
      (async () => {
        try {
          const { getVersionHistory } = await import('~/lib/persistenceGitbase/api.client');
          const versions = await getVersionHistory(projectPath);

          if (cancelled) {
            return;
          }

          const map = new Map<string, string>(versions.map((v: VersionEntry) => [v.commitHash, v.commitTitle]));
          dispatch({ type: 'SET_SAVED_VERSIONS', versions: map });
        } catch (e) {
          console.error('Failed to fetch version history:', e);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // 2) subscribe to save/delete events (UI immediate reflection)
  React.useEffect(() => {
    const unsubscribe = versionEventStore.subscribe((event) => {
      if (!event) {
        return;
      }

      if (event.type === 'save' && event.commitTitle) {
        dispatch({ type: 'ADD_SAVED_VERSION', commitHash: event.commitHash, commitTitle: event.commitTitle });
      } else if (event.type === 'delete') {
        dispatch({ type: 'REMOVE_SAVED_VERSION', commitHash: event.commitHash });
      }
    });

    return () => unsubscribe();
  }, []);

  // 3) handlers
  const openSave = React.useCallback((message: UIMessage) => {
    dispatch({ type: 'OPEN_SAVE', message });
  }, []);

  const openRestore = React.useCallback((commitHash: string, commitTitle: string) => {
    dispatch({ type: 'OPEN_RESTORE', info: { commitHash, commitTitle } });
  }, []);

  const closeSave = React.useCallback(() => dispatch({ type: 'CLOSE_SAVE' }), []);
  const closeRestore = React.useCallback(() => dispatch({ type: 'CLOSE_RESTORE' }), []);

  // 4) Restore confirm logic (modal OK)
  const confirmRestore = React.useCallback(async () => {
    if (!state.restore.info || !projectPath) {
      return;
    }

    // Close modal immediately to prevent duplicate clicks
    const restoreInfo = state.restore.info;
    dispatch({ type: 'CLOSE_RESTORE' });

    await restoreVersion({
      projectPath,
      commitHash: restoreInfo.commitHash,
      commitTitle: restoreInfo.commitTitle,
    });
  }, [state.restore.info, projectPath]);

  // 5) Save confirm logic (modal Save)
  const confirmSave = React.useCallback(
    async (title: string, description: string) => {
      const selectedMessage = state.save.message;

      if (!selectedMessage || !projectPath) {
        return;
      }

      const commitHash = selectedMessage.id.split('-').pop();

      if (!commitHash || !isCommitHash(commitHash)) {
        handleChatError('No commit hash found', {
          context: 'useVersionFeature/confirmSave - commit hash validation',
        });
        dispatch({ type: 'CLOSE_SAVE' });

        return;
      }

      // Close modal first
      dispatch({ type: 'CLOSE_SAVE' });

      const toastId = toast.loading('Saving version...');

      try {
        // Get commit to extract user message (commit title)
        const { data } = await getCommit(projectPath, commitHash);
        const commitMessage = data.commit.message;

        /*
         * Extract user message from commit message
         * First try to extract from <V8UserMessage> tag, otherwise use first line
         * Apply stripMetadata to remove model/provider/attachments info
         */
        const userMessageMatch = commitMessage.match(/<V8UserMessage>([\s\S]*?)<\/V8UserMessage>/);
        const rawUserMessage = userMessageMatch ? userMessageMatch[1].trim() : commitMessage.split('\n')[0];

        const cleanedMessage = stripMetadata(rawUserMessage).trim();
        const commitTitleFromUserMessage = cleanedMessage
          ? cleanedMessage.split('\n')[0].slice(0, 100) || 'Saved version'
          : 'Saved version';

        const { saveVersion } = await import('~/lib/persistenceGitbase/api.client');
        await saveVersion(
          projectPath,
          commitHash,
          commitTitleFromUserMessage,
          title || undefined,
          description || undefined,
        );

        const { triggerVersionSave } = await import('~/lib/stores/versionEvent');
        triggerVersionSave(commitHash, commitTitleFromUserMessage);

        toast.dismiss(toastId);
        toast.success('Version saved successfully');
      } catch (error) {
        toast.dismiss(toastId);
        handleChatError('Failed to save version', {
          error: error instanceof Error ? error : String(error),
          context: 'useVersionFeature/confirmSave',
        });
      }
    },
    [state.save.message, projectPath],
  );

  // 6) commitTitle extraction helper
  const getCommitTitleFromMessage = (message: UIMessage | null): string | null => {
    if (!message) {
      return null;
    }

    const textPart = message.parts?.find((part) => part.type === 'text');

    if (textPart && 'text' in textPart) {
      return textPart.text.slice(0, 100);
    }

    return null;
  };

  // 7) return modal JSX from hook → ChatImpl is "just plug and play"
  const modals = (
    <>
      <SaveVersionConfirmModal
        isOpen={state.save.open}
        onClose={closeSave}
        onConfirm={confirmSave}
        commitTitle={getCommitTitleFromMessage(state.save.message)}
      />

      <RestoreConfirmModal isOpen={state.restore.open} onClose={closeRestore} onConfirm={confirmRestore} />
    </>
  );

  return {
    savedVersions: state.savedVersions,
    openSave,
    openRestore,
    modals,
  };
}
