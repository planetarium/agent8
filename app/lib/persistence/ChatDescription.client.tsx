import { useState } from 'react';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { repoStore } from '~/lib/stores/repo';
import { EditIcon } from '~/components/ui/Icons';
import CustomIconButton from '~/components/ui/CustomIconButton';
import * as Tooltip from '@radix-ui/react-tooltip';
import { RenameChatModal } from '~/components/ui/RenameChatModal';
import { updateProjectDescription } from '~/lib/persistenceGitbase/api.client';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';

interface ChatDescriptionProps {
  asMenuItem?: boolean;
  onClose?: () => void;
}

export function ChatDescription({ asMenuItem = false, onClose }: ChatDescriptionProps) {
  const repo = useStore(repoStore);
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  if (!repo.title) {
    // doing this to prevent showing edit button until chat description is set
    return null;
  }

  const handleRename = async (newName: string) => {
    if (newName === repo.title) {
      setIsModalOpen(false);
      return;
    }

    // Validate name
    const lengthValid = newName.length > 0 && newName.length <= 100;
    const characterValid = /^[\p{L}\p{M}a-zA-Z0-9 \-_.!?'"():]+$/u.test(newName);

    if (!lengthValid) {
      toast.error('Name must be between 1 and 100 characters.');
      return;
    }

    if (!characterValid) {
      toast.error('Name can only contain letters, numbers, spaces, and basic punctuation.');
      return;
    }

    try {
      await updateProjectDescription(repo.path, newName);

      repoStore.set({
        ...repo,
        title: newName,
      });

      toast.success('Title updated successfully');
      setIsModalOpen(false);
    } catch (error) {
      toast.error('Failed to update title: ' + (error as Error).message);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    onClose?.();
  };

  if (asMenuItem) {
    return (
      <>
        <div
          className="flex items-center gap-4 w-full bg-transparent text-primary text-body-md-medium cursor-pointer"
          onClick={() => setIsModalOpen(true)}
        >
          <EditIcon size={20} />
          <span>Edit Title</span>
        </div>

        <RenameChatModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onConfirm={handleRename}
          currentName={repo.title}
        />
      </>
    );
  }

  return (
    <div className="flex items-center justify-center pt-3 pb-2">
      <div className="flex items-center gap-3">
        <span className="max-w-[150px] truncate">{repo.title}</span>
        {!isSmallViewport && (
          <Tooltip.Root delayDuration={100}>
            <Tooltip.Trigger asChild>
              <CustomIconButton
                icon={<EditIcon size={22} />}
                variant="secondary-outlined"
                size="md"
                onClick={() => setIsModalOpen(true)}
              />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primarytext-body-lg-medium"
                sideOffset={5}
                side="bottom"
              >
                Edit Title
                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </div>

      <RenameChatModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleRename}
        currentName={repo.title}
      />
    </div>
  );
}
