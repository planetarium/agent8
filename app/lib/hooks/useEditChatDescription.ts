import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { repoStore } from '~/lib/stores/repo';
import { updateProjectDescription } from '~/lib/persistenceGitbase/api.client';
interface EditChatDescriptionOptions {
  initialDescription?: string;
  customChatId?: string;
  syncWithGlobalStore?: boolean;
}

type EditChatDescriptionHook = {
  editing: boolean;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
  currentDescription: string;
  toggleEditMode: () => void;
};

/**
 * Hook to manage the state and behavior for editing chat descriptions.
 *
 * Offers functions to:
 * - Switch between edit and view modes.
 * - Manage input changes, blur, and form submission events.
 * - Save updates to IndexedDB and optionally to the global application state.
 *
 * @param {Object} options
 * @param {string} options.initialDescription - The current chat description.
 * @param {string} options.customChatId - Optional ID for updating the description via the sidebar.
 * @param {boolean} options.syncWithGlobalStore - Flag to indicate global description store synchronization.
 * @returns {EditChatDescriptionHook} Methods and state for managing description edits.
 */
export function useEditChatDescription({
  initialDescription,
  customChatId,
}: EditChatDescriptionOptions): EditChatDescriptionHook {
  const [editing, setEditing] = useState(false);
  const [currentDescription, setCurrentDescription] = useState(initialDescription || 'No Name');
  useEffect(() => {
    const unsubscribe = repoStore.subscribe((state) => {
      if (state.title !== currentDescription) {
        setCurrentDescription(state.title);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const toggleEditMode = useCallback(() => setEditing((prev) => !prev), []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentDescription(e.target.value);
  }, []);

  const isValidDescription = useCallback((desc: string): boolean => {
    const trimmedDesc = desc.trim();

    if (trimmedDesc === initialDescription) {
      toggleEditMode();
      return false; // No change, skip validation
    }

    const lengthValid = trimmedDesc.length > 0 && trimmedDesc.length <= 100;

    // Allow letters, numbers, spaces, and common punctuation but exclude characters that could cause issues
    const characterValid = /^[a-zA-Z0-9\s\-_.,!?()[\]{}'"]+$/.test(trimmedDesc);

    if (!lengthValid) {
      toast.error('Description must be between 1 and 100 characters.');
      return false;
    }

    if (!characterValid) {
      toast.error('Description can only contain letters, numbers, spaces, and basic punctuation.');
      return false;
    }

    return true;
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!isValidDescription(currentDescription)) {
        return;
      }

      try {
        await updateProjectDescription(repoStore.get().path, currentDescription);

        repoStore.set({
          ...repoStore.get(),
          title: currentDescription,
        });

        toast.success('Chat description updated successfully');
      } catch (error) {
        toast.error('Failed to update chat description: ' + (error as Error).message);
      }

      toggleEditMode();
    },
    [currentDescription, initialDescription, customChatId],
  );

  return {
    editing,
    handleChange,
    handleSubmit,
    currentDescription,
    toggleEditMode,
  };
}
