import { useEditChatDescription } from '~/lib/hooks';
import { repoStore } from '~/lib/stores/repo';
import { EditIcon, CheckIcon } from '~/components/ui/Icons';
import CustomIconButton from '~/components/ui/CustomIconButton';
import * as Tooltip from '@radix-ui/react-tooltip';

export function ChatDescription() {
  const initialDescription = repoStore.get().title;

  const { editing, handleChange, handleSubmit, currentDescription, toggleEditMode } = useEditChatDescription({
    initialDescription,
  });

  if (!initialDescription) {
    // doing this to prevent showing edit button until chat description is set
    return null;
  }

  return (
    <div className="flex items-center justify-center pt-3 pb-2">
      {editing ? (
        <form onSubmit={handleSubmit} className="flex items-center justify-center">
          <input
            type="text"
            className="bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary rounded px-2 mr-2 w-fit"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            style={{ width: `${Math.min(Math.max(currentDescription.length * 8, 100), 200)}px` }}
          />
          <Tooltip.Root delayDuration={100}>
            <Tooltip.Trigger asChild>
              <CustomIconButton icon={<CheckIcon size={22} />} variant="secondary-outlined" size="md" type="submit" />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
                sideOffset={5}
                side="bottom"
              >
                Save title
                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <span className="max-w-[150px] truncate">{currentDescription}</span>
          <Tooltip.Root delayDuration={100}>
            <Tooltip.Trigger asChild>
              <CustomIconButton
                icon={<EditIcon size={22} />}
                variant="secondary-outlined"
                size="md"
                onClick={toggleEditMode}
              />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
                sideOffset={5}
                side="bottom"
              >
                Rename chat
                <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      )}
    </div>
  );
}
