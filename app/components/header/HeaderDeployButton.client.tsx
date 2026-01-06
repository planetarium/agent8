import { workbenchStore } from '~/lib/stores/workbench';
import { repoStore } from '~/lib/stores/repo';
import { RocketIcon } from '~/components/ui/Icons';
import * as Tooltip from '@radix-ui/react-tooltip';
import LoadingSpinnerIcon from '~/components/ui/Icons/LoadingSpinnerIcon';
import { useStore } from '@nanostores/react';

export function HeaderDeployButton() {
  const isDeploying = useStore(workbenchStore.isPublishing);

  const handleDeploy = async () => {
    const chatId = repoStore.get().path;
    const title = repoStore.get().title || 'Game Project';

    if (chatId) {
      await workbenchStore.publish(chatId, title);
    }
  };

  return (
    <Tooltip.Root delayDuration={100}>
      <Tooltip.Trigger asChild>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDeploy}
            disabled={isDeploying}
            data-track="editor-deploy"
            className="group relative flex h-10 justify-center items-center gap-2 py-3 px-4 rounded-[4px] border border-white/12 bg-[#1A92A4] hover:bg-[#1A7583] active:bg-[#1B5862] hover:border-[#1A7583] active:border-[#1B5862] focus:outline-none focus-visible:after:content-[''] focus-visible:after:absolute focus-visible:after:inset-[-3px] focus-visible:after:rounded-[4px] focus-visible:after:border focus-visible:after:border-[#1A92A4] focus-visible:after:pointer-events-none disabled:border-disabled disabled:bg-disabled disabled:cursor-not-allowed"
          >
            <RocketIcon width={20} height={20} />
            <span className="group-disabled:text-disabled text-[14px] font-semibold leading-[142.9%] text-interactive-on-primary hover:text-[#FCFCFD] active:text-[#FFFFFF]">
              Launch
            </span>
          </button>
          {isDeploying && <LoadingSpinnerIcon />}
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
          sideOffset={5}
          side="bottom"
          align="end"
          alignOffset={0}
        >
          Let's release the game!
          <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-35px]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
